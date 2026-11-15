
from __future__ import annotations

import json
import logging
import os
import pickle
import re
import time
import traceback

from collections import defaultdict
from datetime import date
from pathlib import Path
from threading import Lock

import faiss
import numpy as np
import torch
import torch.nn.functional as F

from flask import Flask, jsonify, request, send_from_directory
from sentence_transformers import SentenceTransformer, CrossEncoder
from transformers import AutoTokenizer, AutoModelForSequenceClassification


# ============================================================
# 기본 설정
# ============================================================

BASE = Path(__file__).resolve().parent
ENGINE_DIR = BASE / "search_engine_v2"
MODEL_DIR = BASE / "nli_model"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

TOP_K = 3
SEARCH_K = 12

ENTAIL_THRESHOLD = float(
    os.getenv("ENTAIL_THRESHOLD", "0.35")
)
CONTRADICTION_THRESHOLD = float(
    os.getenv("CONTRADICTION_THRESHOLD", "0.35")
)

DENSE_MIN = float(os.getenv("DENSE_MIN", "0.55"))
LEX_MIN_TOKENS = int(os.getenv("LEX_MIN_TOKENS", "2"))

CANDIDATE_SIGNAL_THRESHOLD = float(
    os.getenv("CANDIDATE_SIGNAL_THRESHOLD", "0.35")
)

USE_RERANKER = os.getenv("USE_RERANKER", "0") == "1"
USE_COMBINED = os.getenv("USE_COMBINED", "0") == "1"

# C0 테스트 완료 전에는 날짜 기반 순위 변경 비활성화
USE_ASOF_RANKING = False

# CPU에서 한 번에 처리할 NLI 후보 수
NLI_BATCH_SIZE = max(
    1, int(os.getenv("NLI_BATCH_SIZE", "4"))
)

app = Flask(__name__, static_folder="static")


# ============================================================
# 콘솔 로깅
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format=(
        "%(asctime)s [%(levelname)s] "
        "%(name)s - %(message)s"
    ),
    datefmt="%Y-%m-%d %H:%M:%S",
    force=True,
)

logger = logging.getLogger("factcheck")

logging.getLogger("transformers").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)


def log_step(name: str, started: float):
    elapsed = time.perf_counter() - started
    logger.info("[TIMING] %s: %.3f초", name, elapsed)
    return elapsed


# ============================================================
# 표기 정규화
# ============================================================

_DECADE = re.compile(r"(?<![0-9])['’]?([2-5]0)년대")


def normalize_text(s: str) -> str:
    return _DECADE.sub(
        lambda m: f"20{m.group(1)}년대",
        str(s),
    )


# ============================================================
# 날짜 추출
#
# 원칙
# 1. 숫자만으로 날짜를 추정하지 않는다.
# 2. 완전한 연/월/일 표기만 인식한다.
# 3. 월/일만 있는 경우는 연도 미확정으로 구분한다.
# 4. 실제 달력에 존재하는 날짜만 인정한다.
# 5. 날짜의 의미는 주변 문맥으로 분류한다.
# 6. 발표일이나 행사일을 본문 기준일로 대체하지 않는다.
# ============================================================

# 예:
# 2026년 11월 11일
# 2026. 11. 11.
# 2027. 11. 12(일)
# 2026-11-11
# 2026/11/11
#
# 연도는 2000~2099년의 네 자리 숫자만 허용한다.
# 기존의 '26 같은 두 자리 연도는 오인식 방지를 위해 제외한다.

_YEAR = r"20\d{2}"
_MONTH = r"(?:0?[1-9]|1[0-2])"
_DAY = r"(?:0?[1-9]|[12]\d|3[01])"

_FULL_DATE = re.compile(
    rf"(?<![0-9A-Za-z])"
    rf"(?P<year>{_YEAR})"
    rf"(?:"
    rf"\s*년\s*"
    rf"(?P<month_kr>{_MONTH})\s*월\s*"
    rf"(?P<day_kr>{_DAY})\s*일"
    rf"|"
    rf"\s*(?P<sep>[./-])\s*"
    rf"(?P<month_num>{_MONTH})\s*(?P=sep)\s*"
    rf"(?P<day_num>{_DAY})"
    rf"(?:\s*\.)?"
    rf")"
    rf"(?:\s*\([월화수목금토일]\))?"
    rf"(?![0-9A-Za-z./-])"
)

# 연도가 없는 날짜는 한국어 월/일 표기만 허용한다.
# 5.7 같은 숫자 표기는 날짜로 인식하지 않는다.
#
# 예:
# 11월 11일
# 11월 11일(수)
#
# 연도가 없으므로 YYYY-MM-DD로 변환하지 않는다.

_PARTIAL_DATE = re.compile(
    rf"(?<![0-9A-Za-z./-])"
    rf"(?P<month>{_MONTH})\s*월\s*"
    rf"(?P<day>{_DAY})\s*일"
    rf"(?:\s*\([월화수목금토일]\))?"
    rf"(?![0-9A-Za-z./-])"
)

# 날짜 뒤에 명시적으로 붙는 기준일 표현만 인정한다.
# '현황', '통계', '누적' 같은 일반 단어만으로는
# 본문 기준일이라고 판정하지 않는다.

_ASOF_AFTER = re.compile(
    r"^\s*"
    r"(?:"
    r"기준(?:일|으로|으로\s*하여)?"
    r"|현재"
    r"|시점(?:을\s*기준으로)?"
    r"|기준\s*집계"
    r")"
    r"(?=$|[\s,.:;)\]）]|[가-힣])"
)

_ASOF_BEFORE = re.compile(
    r"(?:기준일|집계\s*기준일|기준\s*시점)"
    r"\s*[:：]?\s*$"
)

_EVENT_AFTER = re.compile(
    r"^\s*"
    r"(?:"
    r"개최|행사|시행|발효|적용|예정|"
    r"마감|접수|신청|공모|시작|종료|"
    r"부터|까지|발령|개막|개최될"
    r")"
)

_PUBLICATION_AFTER = re.compile(
    r"^\s*"
    r"(?:"
    r"발표|보도|게시|공개|배포|등록|"
    r"작성|발행|공표|보도자료"
    r")"
)

_EVENT_BEFORE = re.compile(
    r"(?:행사일|개최일|시행일|적용일|"
    r"발효일|마감일|접수일)"
    r"\s*[:：]?\s*$"
)

_PUBLICATION_BEFORE = re.compile(
    r"(?:발행일|발표일|보도일|게시일|"
    r"공개일|배포일|등록일|작성일)"
    r"\s*[:：]?\s*$"
)


def _valid_date(
    year: int | None,
    month: int,
    day: int,
) -> bool:
    try:
        # 연도가 없을 때는 윤년인 2024년을 이용해
        # 월/일 조합의 가능 여부만 확인한다.
        date(year if year is not None else 2024, month, day)
        return True
    except ValueError:
        return False


def _date_role(before: str, after: str) -> str:
    """
    날짜 주변 문맥을 기준으로 역할을 분류한다.

    as_of       : 명시적인 기준일
    event       : 행사일, 시행일 등
    publication : 발표일, 발행일 등
    unspecified : 날짜는 맞지만 역할 미확인
    """

    immediate_after = after[:40]
    immediate_before = before[-35:]

    if _ASOF_AFTER.search(immediate_after):
        return "as_of"

    if _ASOF_BEFORE.search(immediate_before):
        return "as_of"

    if _EVENT_AFTER.search(immediate_after):
        return "event"

    if _EVENT_BEFORE.search(immediate_before):
        return "event"

    if _PUBLICATION_AFTER.search(immediate_after):
        return "publication"

    if _PUBLICATION_BEFORE.search(immediate_before):
        return "publication"

    return "unspecified"


def extract_dates(
    text: str,
    published_date: str = "",
) -> list[dict]:
    """
    공식문서에서 명확한 날짜 표기만 추출한다.

    published_date는 기존 함수 호출과의 호환성을
    위해 유지한다. 문서 발행일을 본문 기준일로
    자동 대체하지 않는다.
    """

    text = str(text or "")

    matches = []
    occupied = []

    # 1. 연/월/일이 모두 있는 날짜
    for match in _FULL_DATE.finditer(text):
        matches.append((match, True))
        occupied.append(match.span())

    # 2. 연도 없는 월/일 날짜
    for match in _PARTIAL_DATE.finditer(text):
        start, end = match.span()

        # 이미 인식한 전체 날짜의 일부라면 제외
        if any(
            start < used_end and end > used_start
            for used_start, used_end in occupied
        ):
            continue

        matches.append((match, False))

    matches.sort(key=lambda item: item[0].start())

    results = []
    seen = set()

    for match, has_year in matches:

        if has_year:
            year = int(match.group("year"))

            month = int(
                match.group("month_kr")
                or match.group("month_num")
            )

            day = int(
                match.group("day_kr")
                or match.group("day_num")
            )

        else:
            year = None
            month = int(match.group("month"))
            day = int(match.group("day"))

        # 3. 실제 달력에 존재하는 날짜인지 확인
        if not _valid_date(year, month, day):
            continue

        # 4. 날짜 전후 문맥 확인
        before = text[
            max(0, match.start() - 35):match.start()
        ]

        after = text[
            match.end():match.end() + 50
        ]

        role = _date_role(before, after)

        # 5. 날짜 표준화
        if year is not None:
            value = (
                f"{year:04d}-{month:02d}-{day:02d}"
            )
        else:
            value = f"{month:02d}-{day:02d}"

        # 6. 중복 제거
        key = (value, role)

        if key in seen:
            continue

        seen.add(key)

        results.append({
            "date": value,
            "role": role,
            "text": match.group(0).strip(),
            "explicit_year": year is not None,
        })

    return results


def extract_asof(
    text: str,
    published_date: str = "",
) -> str:
    """
    명시적인 본문 기준일만 반환한다.

    여러 기준일이 있으면 임의로 하나를 선택하지
    않고 빈 문자열을 반환한다.
    """

    dates = extract_dates(text, published_date)

    values = {
        item["date"]
        for item in dates
        if item["role"] == "as_of"
    }

    if len(values) == 1:
        return next(iter(values))

    return ""


def asof_conflicts(
    claim_asof: str,
    chunk_asof: str,
) -> bool:

    if not claim_asof or not chunk_asof:
        return False

    if claim_asof[-5:] != chunk_asof[-5:]:
        return True

    if (
        len(claim_asof) == 10
        and len(chunk_asof) == 10
    ):
        return claim_asof != chunk_asof

    return False


# ============================================================
# 검색 / NLI 파이프라인
# ============================================================

class Pipeline:

    def __init__(self):

        total_start = time.perf_counter()

        logger.info("=" * 60)
        logger.info("[INIT] Pipeline 초기화 시작")
        logger.info("[INIT] Device: %s", DEVICE)
        logger.info("[INIT] Engine dir: %s", ENGINE_DIR)
        logger.info("[INIT] Model dir: %s", MODEL_DIR)

        # ----------------------------------------------------
        # 설정 로딩
        # ----------------------------------------------------

        t = time.perf_counter()

        config_path = ENGINE_DIR / "engine_config.json"
        meta_path = ENGINE_DIR / "engine_meta.pkl"
        index_path = ENGINE_DIR / "faiss_index.bin"

        for path in [
            config_path,
            meta_path,
            index_path,
            MODEL_DIR,
        ]:
            if not path.exists():
                raise FileNotFoundError(
                    f"필수 파일 또는 폴더가 없습니다: {path}"
                )

        cfg = json.loads(
            config_path.read_text(encoding="utf-8")
        )

        with open(meta_path, "rb") as f:
            meta = pickle.load(f)

        self.cfg = cfg
        self.chunk_texts = meta["chunk_texts"]
        self.chunk_meta = meta["chunk_meta"]

        logger.info(
            "[INIT] 청크 수: %d",
            len(self.chunk_texts),
        )

        log_step("설정 및 메타데이터 로딩", t)

        # ----------------------------------------------------
        # FAISS 인덱스
        # ----------------------------------------------------

        t = time.perf_counter()

        with open(index_path, "rb") as f:
            index_bytes = f.read()

        self.index = faiss.deserialize_index(
            np.frombuffer(
                index_bytes,
                dtype=np.uint8,
            )
        )

        logger.info(
            "[INIT] FAISS index.ntotal=%d",
            self.index.ntotal,
        )

        log_step("FAISS 인덱스 로딩", t)

        # ----------------------------------------------------
        # 임베딩 모델
        # ----------------------------------------------------

        t = time.perf_counter()

        logger.info("[INIT] 임베딩 모델 로딩 시작")

        self.embedder = SentenceTransformer(
            cfg["embedder_model"],
            device=DEVICE,
        )

        log_step("임베딩 모델 로딩", t)

        # ----------------------------------------------------
        # Reranker
        # ----------------------------------------------------

        self.reranker = None

        if USE_RERANKER:

            t = time.perf_counter()

            self.reranker = CrossEncoder(
                cfg["reranker_model"],
                max_length=512,
                device=DEVICE,
            )

            log_step("Reranker 로딩", t)

        # ----------------------------------------------------
        # NLI 모델
        # ----------------------------------------------------

        t = time.perf_counter()

        logger.info("[INIT] NLI 모델 로딩 시작")

        self.tokenizer = AutoTokenizer.from_pretrained(
            str(MODEL_DIR),
            local_files_only=True,
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

        log_step("NLI 모델 로딩", t)

        # ----------------------------------------------------
        # 추론 설정
        # ----------------------------------------------------

        self.rerank_candidates = int(
            cfg.get("rerank_candidates", 20)
        )

        cap = int(
            getattr(
                self.nli.config,
                "max_position_embeddings",
                512,
            )
        ) - 2

        self.max_len = min(510, cap)

        # ----------------------------------------------------
        # 문서별 청크 인덱스
        # ----------------------------------------------------

        t = time.perf_counter()

        self.document_chunks = defaultdict(list)

        for idx, chunk_meta in enumerate(
            self.chunk_meta
        ):
            item = {
                "chunk_idx": idx,
                "chunk_text": self.chunk_texts[idx],
                **dict(chunk_meta),
            }

            key = self._document_key(item)

            self.document_chunks[key].append(item)

        log_step("문서별 청크 인덱스 구성", t)

        logger.info(
            "[INIT] 문서 그룹 수: %d",
            len(self.document_chunks),
        )

        log_step(
            "Pipeline 전체 초기화",
            total_start,
        )

        logger.info("[INIT] Pipeline 초기화 완료")
        logger.info("=" * 60)

    # --------------------------------------------------------
    # FAISS 검색
    # --------------------------------------------------------

    def search(
        self,
        query: str,
        top_k: int = SEARCH_K,
    ):

        started = time.perf_counter()

        logger.info("[SEARCH] 임베딩 시작")

        qv = self.embedder.encode(
            [query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype("float32")

        log_step("쿼리 임베딩", started)

        t = time.perf_counter()

        n_cand = (
            max(self.rerank_candidates, top_k * 4)
            if self.reranker
            else top_k * 4
        )

        scores, idxs = self.index.search(
            qv,
            min(n_cand, self.index.ntotal),
        )

        log_step("FAISS 검색", t)

        cands = []

        for dense, idx in zip(
            scores[0],
            idxs[0],
        ):

            if idx < 0:
                continue

            m = dict(
                self.chunk_meta[int(idx)]
            )

            cands.append({
                **m,
                "chunk_idx": int(idx),
                "dense_score": float(dense),
                "chunk_text": (
                    self.chunk_texts[int(idx)]
                ),
            })

        if self.reranker and cands:

            t = time.perf_counter()

            pairs = [
                (query, c["chunk_text"])
                for c in cands
            ]

            rs = self.reranker.predict(
                pairs,
                batch_size=32,
                show_progress_bar=False,
            )

            for c, r in zip(cands, rs):
                c["rerank_score"] = float(r)

            cands.sort(
                key=lambda x: x["rerank_score"],
                reverse=True,
            )

            log_step("Reranker 추론", t)

        else:

            cands.sort(
                key=lambda x: x["dense_score"],
                reverse=True,
            )

        result = cands[:top_k]

        logger.info(
            "[SEARCH] 최종 검색 후보: %d개",
            len(result),
        )

        return result

    # --------------------------------------------------------
    # NLI 배치 추론
    # --------------------------------------------------------

    @torch.inference_mode()
    def nli_scores_batch(
        self,
        premises: list[str],
        hypothesis: str,
    ) -> list[dict]:

        if not premises:
            return []

        started = time.perf_counter()

        logger.info(
            "[NLI] 추론 시작: %d개, batch_size=%d",
            len(premises),
            NLI_BATCH_SIZE,
        )

        id2label = {
            int(k): str(v).lower()
            for k, v in (
                self.nli.config.id2label.items()
            )
        }

        results = []

        for start in range(
            0,
            len(premises),
            NLI_BATCH_SIZE,
        ):

            batch = premises[
                start:start + NLI_BATCH_SIZE
            ]

            t = time.perf_counter()

            enc = self.tokenizer(
                [
                    normalize_text(p)
                    for p in batch
                ],
                [
                    normalize_text(hypothesis)
                ] * len(batch),
                truncation="only_first",
                max_length=self.max_len,
                padding=True,
                return_token_type_ids=False,
                return_tensors="pt",
            )

            enc = {
                k: v.to(DEVICE)
                for k, v in enc.items()
            }

            probs = F.softmax(
                self.nli(**enc).logits,
                dim=-1,
            ).detach().cpu().numpy()

            for row in probs:

                by_label = {
                    id2label[i]: float(row[i])
                    for i in range(len(row))
                }

                results.append({
                    "p_entail": by_label.get(
                        "entailment",
                        0.0,
                    ),
                    "p_neutral": by_label.get(
                        "neutral",
                        0.0,
                    ),
                    "p_contradiction": by_label.get(
                        "contradiction",
                        0.0,
                    ),
                })

            logger.info(
                "[NLI] %d/%d개 완료 (%.2f초)",
                min(
                    start + len(batch),
                    len(premises),
                ),
                len(premises),
                time.perf_counter() - t,
            )

        log_step(
            "NLI 전체 추론",
            started,
        )

        return results

    def nli_scores(
        self,
        premise: str,
        hypothesis: str,
    ):

        return self.nli_scores_batch(
            [premise],
            hypothesis,
        )[0]

    # --------------------------------------------------------
    # 날짜 메타데이터
    # --------------------------------------------------------

    @staticmethod
    def _date_fields(c: dict):

        published_date = (
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
            "unverified",
        }

        reliable = (
            bool(published_date)
            and str(date_source).lower()
            not in low_conf_sources
        )

        if published_date and not date_source:
            date_source = "unverified"
            reliable = False

        return (
            str(published_date),
            str(date_source),
            reliable,
        )

    # --------------------------------------------------------
    # 문서 식별
    # --------------------------------------------------------

    @staticmethod
    def _document_key(e: dict) -> str:

        doc_id = str(
            e.get("doc_id")
            or e.get("chunk_doc")
            or ""
        ).strip()

        if doc_id:
            return f"doc::{doc_id}"

        url = str(
            e.get("url")
            or e.get("doc_url")
            or ""
        ).strip()

        if url:
            return f"url::{url.rstrip('/')}"

        source = str(
            e.get("source")
            or e.get("doc_source")
            or ""
        ).strip()

        title = str(
            e.get("title")
            or e.get("doc_title")
            or ""
        ).strip()

        if source or title:
            return f"title::{source}::{title}"

        return f"chunk::{e.get('chunk_idx')}"

    # --------------------------------------------------------
    # 문서 전체 날짜 탐색
    # --------------------------------------------------------

    def _document_dates(
        self,
        evidence_item: dict,
    ) -> list[dict]:

        key = self._document_key(
            evidence_item
        )

        chunks = self.document_chunks.get(
            key,
            [],
        )

        if not chunks:
            chunks = [evidence_item]

        found = []
        seen = set()

        for chunk in chunks:

            published_date, _, _ = (
                self._date_fields(chunk)
            )

            for item in extract_dates(
                chunk.get("chunk_text", ""),
                published_date,
            ):

                identity = (
                    item["date"],
                    item["role"],
                )

                if identity in seen:
                    continue

                seen.add(identity)
                found.append(item)

        return found

    @staticmethod
    def _select_document_asof(
        body_dates: list[dict],
    ) -> str:

        values = {
            item["date"]
            for item in body_dates
            if item["role"] == "as_of"
        }

        # 기준일이 정확히 하나일 때만 표시한다.
        # 여러 날짜가 있다면 임의 선택하지 않는다.
        if len(values) == 1:
            return next(iter(values))

        return ""

    # --------------------------------------------------------
    # 관련성 판단
    # --------------------------------------------------------

    @staticmethod
    def _keywords(text: str):

        toks = re.findall(
            r"[가-힣A-Za-z0-9]+",
            str(text).lower(),
        )

        stop = {
            "관련", "대한", "통해", "위해",
            "에서", "으로", "하고", "있는",
            "있다", "한다", "했다", "발생",
            "관련해", "등", "및",
        }

        return {
            t for t in toks
            if len(t) >= 2 and t not in stop
        }

    def _candidate_is_relevant(
        self,
        sentence: str,
        e: dict,
    ) -> bool:

        if max(
            e["p_entail"],
            e["p_contradiction"],
        ) >= CANDIDATE_SIGNAL_THRESHOLD:
            return True

        if float(
            e.get("dense_score", 0.0)
        ) < DENSE_MIN:
            return False

        q = self._keywords(sentence)
        d = self._keywords(
            e["chunk_text"]
        )

        return len(q & d) >= LEX_MIN_TOKENS

    # --------------------------------------------------------
    # 연구용 문서 결합
    # --------------------------------------------------------

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
                        x.get("chunk_order") or 0
                    ),
                    x["rank"],
                ),
            )

            premise = "\n".join(
                g["chunk_text"]
                for g in group
            )

            sc = self.nli_scores(
                premise,
                sentence,
            )

            out.append({
                "doc_key": key,
                "members": group,
                "ranks": [
                    g["rank"] for g in group
                ],
                **sc,
            })

        return out

    # --------------------------------------------------------
    # 문서 중복 제거
    # --------------------------------------------------------

    def _deduplicate_documents(
        self,
        evidence: list,
    ) -> list:

        deduped = []
        seen_documents = set()

        ordered = sorted(
            evidence,
            key=lambda x: x["rank"],
        )

        for e in ordered:

            key = self._document_key(e)

            if key in seen_documents:
                continue

            seen_documents.add(key)
            deduped.append(e)

        return deduped

    # --------------------------------------------------------
    # 최종 예측
    # --------------------------------------------------------

    def predict(self, sentence: str):

        total_start = time.perf_counter()

        logger.info("=" * 60)
        logger.info("[PREDICT] 검색 요청 시작")

        logger.info(
            "[PREDICT] 입력 길이: %d자",
            len(sentence),
        )

        # 1. 검색
        t = time.perf_counter()

        cands = self.search(
            sentence,
            SEARCH_K,
        )

        search_seconds = log_step(
            "검색 단계 전체",
            t,
        )

        # 2. NLI 배치 추론
        t = time.perf_counter()

        nli_results = self.nli_scores_batch(
            [
                c["chunk_text"]
                for c in cands
            ],
            sentence,
        )

        nli_seconds = log_step(
            "NLI 단계 전체",
            t,
        )

        # 3. 후보 결과 구성
        t = time.perf_counter()

        evidence = []

        for rank, (c, sc) in enumerate(
            zip(cands, nli_results),
            start=1,
        ):

            (
                published_date,
                date_source,
                date_reliable,
            ) = self._date_fields(c)

            item = {
                **c,
                "rank": rank,
                **sc,

                "doc_id": (
                    c.get("doc_id")
                    or c.get("chunk_doc")
                ),

                "title": (
                    c.get("title")
                    or c.get("doc_title", "")
                ),

                "url": (
                    c.get("url")
                    or c.get("doc_url", "")
                ),

                "source": (
                    c.get("source")
                    or c.get("doc_source", "")
                ),

                "published_date": published_date,
                "date_source": date_source,
                "date_reliable": date_reliable,
            }

            body_dates = self._document_dates(
                item
            )

            item["body_dates"] = body_dates

            item["as_of"] = (
                self._select_document_asof(
                    body_dates
                )
            )

            item["candidate_relevant"] = (
                self._candidate_is_relevant(
                    sentence,
                    item,
                )
            )

            evidence.append(item)

        date_seconds = log_step(
            "날짜 추출 및 결과 구성",
            t,
        )

        # 4. 관련 후보 필터링
        relevant = [
            e for e in evidence
            if e["candidate_relevant"]
        ]

        # 5. 문서 중복 제거
        unique_documents = (
            self._deduplicate_documents(
                relevant
            )
        )

        # 6. 날짜 기반 정렬 (비활성화)
        claim_asof = extract_asof(
            sentence
        )

        if USE_ASOF_RANKING and claim_asof:

            unique_documents = sorted(
                unique_documents,
                key=lambda e: asof_conflicts(
                    claim_asof,
                    e.get("as_of", ""),
                ),
            )

        # 7. 최종 3개 문서
        user_evidence = (
            unique_documents[:TOP_K]
        )

        # 8. 연구용 결합
        combos = (
            self._combined(
                sentence,
                relevant,
            )
            if USE_COMBINED
            else []
        )

        total_seconds = (
            time.perf_counter() - total_start
        )

        logger.info(
            "[RESULT] 검색=%d 관련=%d 문서=%d 표시=%d",
            len(cands),
            len(relevant),
            len(unique_documents),
            len(user_evidence),
        )

        logger.info(
            "[TIMING] 검색=%.2fs NLI=%.2fs "
            "날짜=%.2fs 전체=%.2fs",
            search_seconds,
            nli_seconds,
            date_seconds,
            total_seconds,
        )

        logger.info("[PREDICT] 검색 요청 완료")
        logger.info("=" * 60)

        research = {
            "nli_enabled_for_research": True,
            "combined_enabled": USE_COMBINED,
            "combined_tried": len(combos),
            "dense_min": DENSE_MIN,
            "entail_threshold": ENTAIL_THRESHOLD,
            "contradiction_threshold": (
                CONTRADICTION_THRESHOLD
            ),
            "searched_chunks": len(cands),
            "relevant_chunks": len(relevant),
            "unique_documents": (
                len(unique_documents)
            ),
            "displayed_documents": (
                len(user_evidence)
            ),
            "asof_ranking_enabled": (
                USE_ASOF_RANKING
            ),
            "claim_asof": claim_asof,

            "timing": {
                "search_seconds": round(
                    search_seconds,
                    3,
                ),
                "nli_seconds": round(
                    nli_seconds,
                    3,
                ),
                "date_seconds": round(
                    date_seconds,
                    3,
                ),
                "total_seconds": round(
                    total_seconds,
                    3,
                ),
            },

            "candidates": [
                {
                    "rank": e["rank"],
                    "chunk_idx": e["chunk_idx"],
                    "candidate_relevant": (
                        e["candidate_relevant"]
                    ),
                    "dense_score": (
                        e["dense_score"]
                    ),
                    "p_entail": e["p_entail"],
                    "p_neutral": e["p_neutral"],
                    "p_contradiction": (
                        e["p_contradiction"]
                    ),
                }
                for e in evidence
            ],
        }

        if not user_evidence:

            return {
                "status": "insufficient_material",
                "result": "insufficient_material",
                "display": "관련 자료를 찾지 못함",
                "message": (
                    "현재 수집 범위에서는 "
                    "대조 가능한 관련 공식자료를 "
                    "찾지 못했습니다."
                ),
                "evidence": [],
                "research": research,
            }

        return {
            "status": "evidence_found",
            "result": "evidence_found",
            "display": "관련 자료 있음",
            "message": (
                f"현재 수집 범위에서 "
                f"대조 가능한 관련 공식자료 "
                f"{len(user_evidence)}건을 "
                f"찾았습니다. "
                f"아래에서 주장과 원문을 "
                f"직접 비교해 주세요."
            ),
            "evidence": user_evidence,
            "research": research,
        }


# ============================================================
# Pipeline 로딩
# ============================================================

PIPE: Pipeline | None = None
PIPE_LOCK = Lock()


def get_pipe():
    global PIPE

    if PIPE is None:

        with PIPE_LOCK:

            if PIPE is None:

                logger.info(
                    "[INIT] 최초 요청: 모델 초기화 시작"
                )

                started = time.perf_counter()

                try:
                    PIPE = Pipeline()

                except Exception:
                    logger.exception(
                        "[INIT ERROR] Pipeline 초기화 실패"
                    )
                    raise

                log_step(
                    "최초 모델 초기화",
                    started,
                )

    return PIPE


# ============================================================
# 화면
# ============================================================

@app.get("/")
def index():

    return send_from_directory(
        app.static_folder,
        "evidence_screen.html",
    )


# ============================================================
# 서버 상태 확인
# ============================================================

@app.get("/api/health")
def health():

    return jsonify({
        "ok": True,
        "device": DEVICE,
        "pipeline_loaded": PIPE is not None,
        "reranker_enabled": USE_RERANKER,
        "combined_enabled": USE_COMBINED,
        "dense_min": DENSE_MIN,
        "display_top_k": TOP_K,
        "search_k": SEARCH_K,
        "nli_batch_size": NLI_BATCH_SIZE,
        "asof_ranking_enabled": USE_ASOF_RANKING,
    })


# ============================================================
# 검색 API
# ============================================================

@app.post("/api/predict")
def predict():

    request_start = time.perf_counter()

    logger.info("=" * 60)
    logger.info("[HTTP] POST /api/predict 요청 수신")

    try:

        body = request.get_json(
            silent=True
        ) or {}

        sentence = str(
            body.get("sentence", "")
        ).strip()

        if not sentence:

            logger.warning(
                "[HTTP] 입력 문장이 비어 있음"
            )

            return jsonify({
                "error": "sentence is required"
            }), 400

        if len(sentence) > 2000:

            logger.warning(
                "[HTTP] 입력 문장이 너무 김"
            )

            return jsonify({
                "error": "sentence is too long"
            }), 400

        # 모델 로딩 시간 측정
        t = time.perf_counter()

        pipeline = get_pipe()

        model_load_seconds = (
            time.perf_counter() - t
        )

        logger.info(
            "[TIMING] 모델 준비: %.2f초",
            model_load_seconds,
        )

        # 검색 시간 측정
        t = time.perf_counter()

        result = pipeline.predict(
            sentence
        )

        predict_seconds = (
            time.perf_counter() - t
        )

        total_seconds = (
            time.perf_counter() - request_start
        )

        logger.info(
            "[HTTP] 요청 성공 "
            "model_load=%.2fs "
            "predict=%.2fs "
            "total=%.2fs",
            model_load_seconds,
            predict_seconds,
            total_seconds,
        )

        if total_seconds > 60:

            logger.warning(
                "[TIMEOUT WARNING] "
                "백엔드 처리 시간이 60초를 초과했습니다. "
                "프론트엔드에서 이미 시간초과가 "
                "발생했을 수 있습니다."
            )

        return jsonify(result)

    except Exception as e:

        elapsed = (
            time.perf_counter() - request_start
        )

        logger.error("=" * 60)

        logger.error(
            "[BACKEND ERROR] 검색 처리 실패"
        )

        logger.error(
            "[BACKEND ERROR] 오류 종류: %s",
            type(e).__name__,
        )

        logger.error(
            "[BACKEND ERROR] 오류 메시지: %s",
            str(e),
        )

        logger.error(
            "[BACKEND ERROR] 경과 시간: %.2f초",
            elapsed,
        )

        logger.error(
            "[BACKEND ERROR] 전체 Traceback:\n%s",
            traceback.format_exc(),
        )

        logger.error("=" * 60)

        return jsonify({
            "error": "backend_prediction_failed",
            "message": str(e),
            "error_type": type(e).__name__,
            "elapsed_seconds": round(
                elapsed,
                3,
            ),
        }), 500


# ============================================================
# 전역 오류 처리
# ============================================================

@app.errorhandler(Exception)
def handle_unexpected_error(error):

    logger.exception(
        "[UNHANDLED ERROR] 처리되지 않은 서버 오류: %s",
        error,
    )

    from werkzeug.exceptions import HTTPException

    if isinstance(error, HTTPException):

        return jsonify({
            "error": error.name,
            "message": error.description,
        }), error.code

    return jsonify({
        "error": "internal_server_error",
        "message": str(error),
    }), 500


# ============================================================
# 실행
# ============================================================

if __name__ == "__main__":

    logger.info("=" * 60)
    logger.info("FactCheck Backend Starting")
    logger.info("Device: %s", DEVICE)
    logger.info("Reranker: %s", USE_RERANKER)
    logger.info("Combined: %s", USE_COMBINED)
    logger.info("Dense min: %s", DENSE_MIN)
    logger.info("Lex min: %s", LEX_MIN_TOKENS)
    logger.info("Search K: %s", SEARCH_K)
    logger.info("Display TOP K: %s", TOP_K)
    logger.info("NLI batch size: %s", NLI_BATCH_SIZE)
    logger.info("ASOF ranking: %s", USE_ASOF_RANKING)
    logger.info("Open http://127.0.0.1:8001")
    logger.info("=" * 60)

    app.run(
        host="127.0.0.1",
        port=8001,
        debug=False,
        threaded=True,
    )
