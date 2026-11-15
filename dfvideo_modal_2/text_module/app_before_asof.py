from __future__ import annotations

import json
import os
import pickle
import re

from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import faiss

from flask import Flask, jsonify, request, send_from_directory
from sentence_transformers import SentenceTransformer, CrossEncoder
from transformers import AutoTokenizer, AutoModelForSequenceClassification


# ─────────────────────────────────────────────
# 기본 설정
# ─────────────────────────────────────────────

BASE = Path(__file__).resolve().parent
ENGINE_DIR = BASE / "search_engine_v2"
MODEL_DIR = BASE / "nli_model"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# 사용자 화면에 최종적으로 보여줄 관련 자료 수
TOP_K = 3

# 같은 문서의 여러 청크가 검색되는 경우를 고려해
# 실제 검색 단계에서는 더 많은 후보를 가져온다.
SEARCH_K = max(TOP_K * 4, 12)

ENTAIL_THRESHOLD = float(
    os.getenv("ENTAIL_THRESHOLD", "0.35")
)

CONTRADICTION_THRESHOLD = float(
    os.getenv("CONTRADICTION_THRESHOLD", "0.35")
)


# ─────────────────────────────────────────────
# 관련성 게이트
# ─────────────────────────────────────────────
#
# 예비 진단셋 50건으로 맞춘 값이다.
#
# 사람이 DB 근거를 확인한 16건과
# 근거가 없는 34건을 놓고 비교한 결과:
#
# 현재 규칙(NLI 신호 0.05 또는 어휘 1개 겹침)
# → 근거 16/16 보존, 오통과 24/34
#
# dense>=0.55 그리고 겹침>=2
# → 근거 15/16 보존, 오통과 9/34
#
# FAISS는 항상 가장 가까운 결과를 반환하기 때문에
# 검색 결과가 존재한다는 사실만으로
# 관련 자료라고 판단하지 않는다.

DENSE_MIN = float(
    os.getenv("DENSE_MIN", "0.55")
)

LEX_MIN_TOKENS = int(
    os.getenv("LEX_MIN_TOKENS", "2")
)

CANDIDATE_SIGNAL_THRESHOLD = float(
    os.getenv(
        "CANDIDATE_SIGNAL_THRESHOLD",
        "0.35",
    )
)


USE_RERANKER = (
    os.getenv("USE_RERANKER", "0") == "1"
)

# 같은 문서에서 여러 청크가 검색된 경우
# 연구용으로 청크를 결합해 NLI를 계산할지 여부.
USE_COMBINED = (
    os.getenv("USE_COMBINED", "0") == "1"
)


app = Flask(
    __name__,
    static_folder="static",
)


# ─────────────────────────────────────────────
# 표기 정규화
# ─────────────────────────────────────────────

_DECADE = re.compile(
    r"(?<![0-9])['’]?([2-5]0)년대"
)


def normalize_text(s: str) -> str:
    return _DECADE.sub(
        lambda m: f"20{m.group(1)}년대",
        str(s),
    )


# ─────────────────────────────────────────────
# 본문 기준일 추출
# ─────────────────────────────────────────────

_ASOF = [
    re.compile(
        r"(\d{1,2}\s*\.\s*\d{1,2})"
        r"\s*\.?\s*24\s*시\s*기준"
    ),

    re.compile(
        r"(\d{1,2}\s*월\s*\d{1,2}\s*일)"
        r"\s*기준"
    ),

    re.compile(
        r"['’]?\d{2}\s*\.\s*"
        r"(\d{1,2}\s*\.\s*\d{1,2})"
        r"\s*\.?\s*24\s*시"
    ),
]


def extract_asof(text: str) -> str:

    for pat in _ASOF:

        m = pat.search(
            str(text)
        )

        if m:
            return re.sub(
                r"\s+",
                "",
                m.group(1),
            )

    return ""


# ─────────────────────────────────────────────
# 검색 / NLI 파이프라인
# ─────────────────────────────────────────────

class Pipeline:

    def __init__(self):

        cfg = json.loads(
            (
                ENGINE_DIR
                / "engine_config.json"
            ).read_text(
                encoding="utf-8"
            )
        )

        with open(
            ENGINE_DIR / "engine_meta.pkl",
            "rb",
        ) as f:

            meta = pickle.load(f)

        self.cfg = cfg

        self.chunk_texts = (
            meta["chunk_texts"]
        )

        self.chunk_meta = (
            meta["chunk_meta"]
        )


        # Windows의 비ASCII 경로에서도
        # 정상적으로 읽을 수 있도록
        # Python에서 바이트를 읽은 뒤 역직렬화한다.

        index_path = (
            ENGINE_DIR
            / "faiss_index.bin"
        )

        with open(
            index_path,
            "rb",
        ) as f:

            index_bytes = f.read()


        self.index = (
            faiss.deserialize_index(
                np.frombuffer(
                    index_bytes,
                    dtype=np.uint8,
                )
            )
        )


        self.embedder = (
            SentenceTransformer(
                cfg["embedder_model"],
                device=DEVICE,
            )
        )


        self.reranker = None

        if USE_RERANKER:

            self.reranker = (
                CrossEncoder(
                    cfg["reranker_model"],
                    max_length=512,
                    device=DEVICE,
                )
            )


        self.tokenizer = (
            AutoTokenizer.from_pretrained(
                str(MODEL_DIR),
                local_files_only=True,
            )
        )


        self.nli = (
            AutoModelForSequenceClassification
            .from_pretrained(
                str(MODEL_DIR),
                local_files_only=True,
            )
            .to(DEVICE)
        )

        self.nli.eval()


        self.rerank_candidates = int(
            cfg.get(
                "rerank_candidates",
                20,
            )
        )


        # RoBERTa 위치 임베딩 상한
        cap = int(
            getattr(
                self.nli.config,
                "max_position_embeddings",
                512,
            )
        ) - 2

        self.max_len = min(
            510,
            cap,
        )


    # ─────────────────────────────────────────
    # 검색
    # ─────────────────────────────────────────

    def search(
        self,
        query: str,
        top_k: int = SEARCH_K,
    ):

        qv = self.embedder.encode(
            [query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(
            "float32"
        )


        # reranker가 켜져 있으면
        # 최종 검색 수보다 더 넓게 후보를 가져온다.
        n_cand = (

            max(
                self.rerank_candidates,
                top_k * 4,
            )

            if self.reranker

            else top_k * 4
        )


        scores, idxs = (
            self.index.search(
                qv,
                min(
                    n_cand,
                    self.index.ntotal,
                ),
            )
        )


        cands = []


        for dense, idx in zip(
            scores[0],
            idxs[0],
        ):

            if idx < 0:
                continue


            m = dict(
                self.chunk_meta[
                    int(idx)
                ]
            )


            cands.append(
                {
                    "chunk_idx":
                        int(idx),

                    "dense_score":
                        float(dense),

                    "chunk_text":
                        self.chunk_texts[
                            int(idx)
                        ],

                    **m,
                }
            )


        if (
            self.reranker
            and cands
        ):

            pairs = [
                (
                    query,
                    c["chunk_text"],
                )
                for c in cands
            ]


            rs = (
                self.reranker.predict(
                    pairs,
                    batch_size=32,
                    show_progress_bar=False,
                )
            )


            for c, r in zip(
                cands,
                rs,
            ):

                c["rerank_score"] = (
                    float(r)
                )


            cands.sort(
                key=lambda x:
                    x["rerank_score"],
                reverse=True,
            )


        else:

            cands.sort(
                key=lambda x:
                    x["dense_score"],
                reverse=True,
            )


        return cands[:top_k]


    # ─────────────────────────────────────────
    # NLI 점수
    # ─────────────────────────────────────────

    @torch.inference_mode()
    def nli_scores(
        self,
        premise: str,
        hypothesis: str,
    ):

        enc = self.tokenizer(
            normalize_text(premise),
            normalize_text(hypothesis),

            truncation="only_first",

            max_length=self.max_len,

            return_token_type_ids=False,

            return_tensors="pt",
        )


        enc = {
            k: v.to(DEVICE)
            for k, v
            in enc.items()
        }


        probs = F.softmax(
            self.nli(
                **enc
            ).logits,
            dim=-1,
        )[0].detach().cpu().numpy()


        id2label = {

            int(k):
                str(v).lower()

            for k, v
            in self.nli.config.id2label.items()

        }


        by_label = {

            id2label[i]:
                float(probs[i])

            for i
            in range(len(probs))

        }


        return {

            "p_entail":
                by_label.get(
                    "entailment",
                    0.0,
                ),

            "p_neutral":
                by_label.get(
                    "neutral",
                    0.0,
                ),

            "p_contradiction":
                by_label.get(
                    "contradiction",
                    0.0,
                ),
        }


    # ─────────────────────────────────────────
    # 날짜 메타데이터
    # ─────────────────────────────────────────

    @staticmethod
    def _date_fields(c: dict):

        date = (
            c.get("published_date")
            or c.get("doc_published_date")
            or c.get("chunk_pub_date")
            or ""
        )


        date_source = (
            c.get("date_source")
            or c.get("doc_date_source")
            or c.get("published_date_source")
            or ""
        )


        low_conf_sources = {
            "generic",
            "unknown",
            "inferred",
            "estimated",
        }


        reliable = (

            bool(date)

            and

            str(
                date_source
            ).lower()

            not in low_conf_sources

        )


        if (
            date
            and not date_source
        ):

            date_source = (
                "unverified"
            )

            reliable = True


        return (
            str(date),
            str(date_source),
            reliable,
        )


    # ─────────────────────────────────────────
    # 관련성 판단용 키워드
    # ─────────────────────────────────────────

    @staticmethod
    def _keywords(
        text: str,
    ):

        toks = re.findall(
            r"[가-힣A-Za-z0-9]+",
            str(text).lower(),
        )


        stop = {

            "관련",
            "대한",
            "통해",
            "위해",
            "에서",
            "으로",
            "하고",
            "있는",
            "있다",
            "한다",
            "했다",
            "발생",
            "관련해",
            "등",
            "및",

        }


        return {

            t

            for t
            in toks

            if (
                len(t) >= 2
                and t not in stop
            )

        }


    # ─────────────────────────────────────────
    # 검색 후보 관련성 게이트
    # ─────────────────────────────────────────

    def _candidate_is_relevant(
        self,
        sentence: str,
        e: dict,
    ) -> bool:

        # NLI의 강한 신호는
        # 후보 정리에만 사용한다.
        #
        # 사용자에게 사실/거짓을
        # 판정하는 기능이 아니다.

        if max(
            e["p_entail"],
            e["p_contradiction"],
        ) >= CANDIDATE_SIGNAL_THRESHOLD:

            return True


        # 검색 유사도가 너무 낮으면
        # 관련 후보에서 제외한다.

        if float(
            e.get(
                "dense_score",
                0.0,
            )
        ) < DENSE_MIN:

            return False


        q = self._keywords(
            sentence
        )

        d = self._keywords(
            e["chunk_text"]
        )


        return (
            len(q & d)
            >= LEX_MIN_TOKENS
        )


    # ─────────────────────────────────────────
    # 같은 문서의 여러 청크 결합
    # 연구용
    # ─────────────────────────────────────────

    def _combined(
        self,
        sentence: str,
        evidence: list,
    ):

        if not USE_COMBINED:
            return []


        groups = defaultdict(list)


        for e in evidence:

            key = (
                e.get("doc_id")
                or e.get("url")
                or e.get("title")
            )


            if key:
                groups[key].append(e)


        out = []


        for key, group in groups.items():

            if len(group) < 2:
                continue


            group = sorted(

                group,

                key=lambda x: (

                    int(
                        x.get(
                            "chunk_order"
                        )
                        or 0
                    ),

                    x["rank"],

                ),
            )


            premise = "\n".join(

                g["chunk_text"]

                for g
                in group

            )


            sc = self.nli_scores(
                premise,
                sentence,
            )


            out.append(
                {

                    "doc_key":
                        key,

                    "members":
                        group,

                    "ranks":
                        [
                            g["rank"]
                            for g
                            in group
                        ],

                    **sc,
                }
            )


        return out


    # ─────────────────────────────────────────
    # 동일 문서 판별용 키 생성
    # ─────────────────────────────────────────

    @staticmethod
    def _document_key(
        e: dict,
    ) -> str:

        """
        같은 공식자료에서 나온 여러 청크를
        하나의 문서로 인식하기 위한 키를 만든다.

        우선순위:
        1. doc_id
        2. URL
        3. 출처 + 제목
        4. chunk_idx
        """

        doc_id = str(
            e.get("doc_id")
            or ""
        ).strip()


        if doc_id:

            return (
                f"doc::{doc_id}"
            )


        url = str(
            e.get("url")
            or ""
        ).strip()


        if url:

            # URL 끝의 "/" 차이 때문에
            # 동일 문서가 다른 것으로 처리되지 않도록 정리
            normalized_url = (
                url.rstrip("/")
            )

            return (
                f"url::{normalized_url}"
            )


        source = str(
            e.get("source")
            or ""
        ).strip()


        title = str(
            e.get("title")
            or ""
        ).strip()


        if (
            source
            or title
        ):

            return (
                f"title::{source}::{title}"
            )


        # 문서 식별자가 전혀 없는 경우에는
        # 임의로 합치지 않고 개별 청크로 유지한다.
        return (
            f"chunk::{e.get('chunk_idx')}"
        )


    # ─────────────────────────────────────────
    # 동일 문서 중복 제거
    # ─────────────────────────────────────────

    def _deduplicate_documents(
        self,
        evidence: list,
    ) -> list:

        """
        검색은 청크 단위로 이루어지지만
        사용자 화면은 문서 단위로 보여준다.

        동일한 공식 문서에서 여러 청크가 검색되면
        검색 순위가 가장 높은 청크 하나만 대표로 남긴다.
        """

        deduped = []

        seen_documents = set()


        # 검색 순위가 높은 청크부터 처리한다.
        ordered = sorted(
            evidence,
            key=lambda x: x["rank"],
        )


        for e in ordered:

            key = (
                self._document_key(e)
            )


            if key in seen_documents:
                continue


            seen_documents.add(
                key
            )


            deduped.append(e)


        return deduped


    # ─────────────────────────────────────────
    # 최종 예측 / 검색 결과 생성
    # ─────────────────────────────────────────

    def predict(
        self,
        sentence: str,
    ):

        """
        사용자 경로:
        자동 진위 결론 없이 관련 자료만 제시한다.

        검색 결과 중 현재 기준에서 관련성이 있는
        공식자료를 사용자가 직접 대조할 수 있도록 제공한다.

        자료가 검색되었다는 사실만으로
        해당 주장이 사실이라고 판정하지 않는다.

        NLI 점수와 관련성 게이트는
        연구/추적용 메타데이터로 유지한다.
        """


        # ─────────────────────────────────────
        # 1. 검색
        #
        # 최종 표시 개수는 3개지만,
        # 동일 문서의 여러 청크가 검색될 수 있으므로
        # 12개 후보를 먼저 검색한다.
        # ─────────────────────────────────────

        cands = self.search(
            sentence,
            SEARCH_K,
        )


        evidence = []


        # ─────────────────────────────────────
        # 2. 검색된 각 청크 분석
        # ─────────────────────────────────────

        for rank, c in enumerate(
            cands,
            start=1,
        ):

            # NLI는 연구/관련 후보 정리를 위해 계산한다.
            # 사용자 진위 결론에는 사용하지 않는다.

            sc = self.nli_scores(
                c["chunk_text"],
                sentence,
            )


            (
                published_date,
                date_source,
                date_reliable,
            ) = self._date_fields(c)


            item = {

                "rank":
                    rank,

                "chunk_idx":
                    c["chunk_idx"],

                "chunk_order":
                    c.get(
                        "chunk_order"
                    ),

                "chunk_text":
                    c["chunk_text"],

                "dense_score":
                    c["dense_score"],

                **sc,

                "doc_id":
                    (
                        c.get("doc_id")
                        or
                        c.get("chunk_doc")
                    ),

                "title":
                    (
                        c.get("title")
                        or
                        c.get(
                            "doc_title",
                            "",
                        )
                    ),

                "url":
                    (
                        c.get("url")
                        or
                        c.get(
                            "doc_url",
                            "",
                        )
                    ),

                "source":
                    (
                        c.get("source")
                        or
                        c.get(
                            "doc_source",
                            "",
                        )
                    ),

                "published_date":
                    published_date,

                "date_source":
                    date_source,

                "date_reliable":
                    date_reliable,

                "as_of":
                    extract_asof(
                        c["chunk_text"]
                    ),
            }


            item[
                "candidate_relevant"
            ] = (
                self._candidate_is_relevant(
                    sentence,
                    item,
                )
            )


            evidence.append(
                item
            )


        # ─────────────────────────────────────
        # 3. 관련 후보만 남김
        # ─────────────────────────────────────

        relevant = [

            e

            for e
            in evidence

            if e[
                "candidate_relevant"
            ]

        ]


        # ─────────────────────────────────────
        # 4. 동일 문서 중복 제거
        #
        # 예:
        #
        # 고용노동부 A문서 - chunk 1
        # 고용노동부 A문서 - chunk 2
        # 고용노동부 A문서 - chunk 3
        #
        # 위와 같이 검색돼도
        # 사용자에게는 A문서를 한 번만 보여준다.
        # ─────────────────────────────────────

        unique_documents = (
            self._deduplicate_documents(
                relevant
            )
        )


        # ─────────────────────────────────────
        # 5. 최종 3개 문서만 사용자에게 표시
        # ─────────────────────────────────────

        user_evidence = (
            unique_documents[
                :TOP_K
            ]
        )


        # ─────────────────────────────────────
        # 6. 연구용 결합 추적
        #
        # 여기서는 중복 제거 전의 relevant를 사용한다.
        #
        # 그래야 같은 문서에서 여러 청크가 검색된 경우
        # 연구용 결합 NLI 기능은 기존대로 사용할 수 있다.
        # ─────────────────────────────────────

        combos = (

            self._combined(
                sentence,
                relevant,
            )

            if USE_COMBINED

            else []
        )


        # ─────────────────────────────────────
        # 7. 연구용 메타데이터
        # ─────────────────────────────────────

        research = {

            "nli_enabled_for_research":
                True,

            "combined_enabled":
                USE_COMBINED,

            "combined_tried":
                len(combos),

            "dense_min":
                DENSE_MIN,

            "entail_threshold":
                ENTAIL_THRESHOLD,

            "contradiction_threshold":
                CONTRADICTION_THRESHOLD,

            # 검색된 청크 수
            "searched_chunks":
                len(cands),

            # 관련성 필터를 통과한 청크 수
            "relevant_chunks":
                len(relevant),

            # 중복 제거 후 문서 수
            "unique_documents":
                len(unique_documents),

            # 실제 사용자에게 표시한 문서 수
            "displayed_documents":
                len(user_evidence),

            "candidates": [

                {

                    "rank":
                        e["rank"],

                    "chunk_idx":
                        e["chunk_idx"],

                    "candidate_relevant":
                        e[
                            "candidate_relevant"
                        ],

                    "dense_score":
                        e[
                            "dense_score"
                        ],

                    "p_entail":
                        e[
                            "p_entail"
                        ],

                    "p_neutral":
                        e[
                            "p_neutral"
                        ],

                    "p_contradiction":
                        e[
                            "p_contradiction"
                        ],

                }

                for e
                in evidence

            ],
        }


        # ─────────────────────────────────────
        # 8. 관련 자료를 찾지 못한 경우
        # ─────────────────────────────────────

        if not user_evidence:

            return {

                "status":
                    "insufficient_material",

                "result":
                    "insufficient_material",

                "display":
                    "관련 자료를 찾지 못함",

                "message":
                    (
                        "현재 수집 범위에서는 "
                        "대조 가능한 관련 공식자료를 "
                        "찾지 못했습니다."
                    ),

                "evidence":
                    [],

                "research":
                    research,
            }


        # ─────────────────────────────────────
        # 9. 관련 자료가 있는 경우
        # ─────────────────────────────────────

        return {

            "status":
                "evidence_found",

            "result":
                "evidence_found",

            "display":
                "관련 자료 있음",

            "message":
                (
                    f"현재 수집 범위에서 "
                    f"대조 가능한 관련 공식자료 "
                    f"{len(user_evidence)}건을 "
                    f"찾았습니다. "
                    f"아래에서 주장과 원문을 "
                    f"직접 비교해 주세요."
                ),

            "evidence":
                user_evidence,

            "research":
                research,
        }


# ─────────────────────────────────────────────
# Pipeline lazy loading
# ─────────────────────────────────────────────

PIPE: Pipeline | None = None


def get_pipe():

    global PIPE

    if PIPE is None:

        PIPE = Pipeline()

    return PIPE


# ─────────────────────────────────────────────
# 화면
# ─────────────────────────────────────────────

@app.get("/")
def index():

    return send_from_directory(
        app.static_folder,
        "evidence_screen.html",
    )


# ─────────────────────────────────────────────
# 서버 상태
# ─────────────────────────────────────────────

@app.get("/api/health")
def health():

    return jsonify(
        {

            "ok":
                True,

            "device":
                DEVICE,

            "pipeline_loaded":
                PIPE is not None,

            "reranker_enabled":
                USE_RERANKER,

            "combined_enabled":
                USE_COMBINED,

            "dense_min":
                DENSE_MIN,

            "display_top_k":
                TOP_K,

            "search_k":
                SEARCH_K,
        }
    )


# ─────────────────────────────────────────────
# 검색 API
# ─────────────────────────────────────────────

@app.post("/api/predict")
def predict():

    body = (
        request.get_json(
            silent=True
        )
        or {}
    )


    sentence = str(
        body.get(
            "sentence",
            "",
        )
    ).strip()


    if not sentence:

        return jsonify(
            {
                "error":
                    "sentence is required"
            }
        ), 400


    if len(sentence) > 2000:

        return jsonify(
            {
                "error":
                    "sentence is too long"
            }
        ), 400


    try:

        return jsonify(
            get_pipe().predict(
                sentence
            )
        )


    except Exception as e:

        app.logger.exception(
            "prediction failed"
        )

        return jsonify(
            {
                "error":
                    str(e)
            }
        ), 500


# ─────────────────────────────────────────────
# 실행
# ─────────────────────────────────────────────

if __name__ == "__main__":

    print(
        f"Device: {DEVICE} / "
        f"reranker: {USE_RERANKER} / "
        f"combined: {USE_COMBINED}"
    )

    print(
        f"dense_min={DENSE_MIN} "
        f"lex_min={LEX_MIN_TOKENS} "
        f"entail_th={ENTAIL_THRESHOLD}"
    )

    print(
        f"display_top_k={TOP_K} "
        f"search_k={SEARCH_K}"
    )

    print(
        "Open http://127.0.0.1:8001"
    )


    app.run(
        host="127.0.0.1",
        port=8001,
        debug=False,
    )