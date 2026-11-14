import { Fragment, useState } from 'react';
import {
  CLAIM_KINDS,
  type ClaimComponents,
  type NormalizedTextResult,
} from '../types/text';

function MarkedText({
  text,
  terms,
  missTerms = [],
}: {
  text: string;
  terms: string[];
  missTerms?: string[];
}) {
  const all = [
    ...terms.map((x) => [x, 'hit'] as const),
    ...missTerms.map((x) => [x, 'miss'] as const),
  ]
    .filter(
      ([x], index, array) =>
        array.findIndex(([y]) => y === x) === index,
    )
    .sort((a, b) => b[0].length - a[0].length);

  if (!all.length) {
    return <>{text}</>;
  }

  const re = new RegExp(
    `(${all
      .map(([x]) =>
        x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('|')})`,
    'g',
  );

  return (
    <>
      {text.split(re).map((part, index) => {
        const found = all.find(([x]) => x === part);

        return found ? (
          <mark
            key={index}
            className={`text-${found[1]}`}
          >
            {part}
          </mark>
        ) : (
          <Fragment key={index}>
            {part}
          </Fragment>
        );
      })}
    </>
  );
}

function flatten(
  components?: Partial<ClaimComponents>,
) {
  return CLAIM_KINDS.flatMap(
    (kind) => components?.[kind] || [],
  );
}

export default function TextAnalysisResult({
  result,
}: {
  result: NormalizedTextResult;
}) {
  const [selected, setSelected] = useState(0);

  const evidence = result.evidence;

  const found =
    result.status === 'evidence_found' &&
    evidence.length > 0;

  const selectedEvidence = evidence[selected];

  const hits = flatten(
    selectedEvidence?.matched,
  );

  const misses = CLAIM_KINDS.flatMap(
    (kind) =>
      (result.comps[kind] || []).filter(
        (value) => !hits.includes(value),
      ),
  );

  const numericItems = result.comps['수치'] || [];
  const numericSourceCount = (result.claim.match(/\d{1,3}(?:,\d{3})+\s*(?:만|억|조)?\s*(?:원|명|개|건|가구|대|톤|달러|불)?|\d+(?:\.\d+)?\s*(?:억|조|만)\s*(?:원|명|개|가구|달러|불)?|\d+(?:\.\d+)?\s*[%％](?:\s*p)?|\d+(?:\.\d+)?\s*(?:명|개|건|가구|곳|개소|배|점|차례|회|종|ha|㎡|㎞|km|mg|도)/g) || []).length;
  const unextractedCount = Math.max(0, numericSourceCount - numericItems.length);

  return (
    <div className="text-results">
      {/* 검색 결과 상태 */}
      <div className="text-state">
        <span
          className={`text-status ${
            found ? 'found' : 'insufficient'
          }`}
        >
          {found
            ? '관련 자료 있음'
            : '관련 자료를 찾지 못함'}
        </span>

        <div>
          <strong>
            검색 결과 · 자동 진위 판정 아님
          </strong>

          <p>
            {found
              ? `현재 수집 범위에서 대조 가능한 관련 공식자료 ${evidence.length}건을 찾았습니다. 아래에서 주장과 원문을 직접 비교해 주세요.`
              : '현재 수집 범위에서는 대조 가능한 관련 공식자료를 찾지 못했습니다.'}
          </p>

          <small>
            {found
              ? '자료가 검색되었다는 사실만으로 입력한 주장이 사실이라고 판정하지 않습니다.'
              : '관련 자료가 존재하지 않거나 주장이 거짓이라는 뜻은 아닙니다. 현재 수집된 자료 범위에서 찾지 못했다는 의미입니다.'}
          </small>
        </div>
      </div>

      <div className="text-columns">
        {/* ========================================
            입력한 주장
        ======================================== */}
        <section>
          <h2>입력한 주장</h2>

          <div className="text-panel text-claim">
            <div className="text-claim-content">
              <MarkedText
                text={result.claim}
                terms={hits}
                missTerms={
                  selectedEvidence
                    ? misses
                    : []
                }
              />
            </div>

            {evidence.length > 0 && (
              <div className="text-legend">
                <span>
                  <i className="text-legend-hit">
                    ■
                  </i>{' '}
                  선택한 자료의 구절과 일치
                </span>

                <span>
                  <i className="text-legend-miss">
                    ■
                  </i>{' '}
                  선택한 구절에서 찾지 못함
                </span>
              </div>
            )}

            {CLAIM_KINDS.some(
              (kind) =>
                result.comps[kind]?.length,
            ) && (
              <div className="text-components">
                <div className="text-components-label">
                  {evidence.length
                    ? '대조할 항목'
                    : '찾으려 한 항목'}
                </div>

                {unextractedCount > 0 && <p className="text-extraction-warning">추출하지 못한 항목 {unextractedCount}개 — 원문에서 직접 확인해 주세요.</p>}
                <dl>
                  {CLAIM_KINDS.filter(
                    (kind) =>
                      result.comps[kind]?.length,
                  ).map((kind) => (
                    <Fragment key={kind}>
                      <dt>{kind}</dt>

                      <dd>
                        {result.comps[
                          kind
                        ].join(' · ')}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </section>

        {/* ========================================
            관련 자료에서 확인하기
        ======================================== */}
        <section>
          <h2>
            관련 자료에서 확인하기
          </h2>

          {!evidence.length ? (
            /* 관련 자료 없음 */
            <div className="text-panel text-empty-result">
              <p className="text-empty-title">
                <strong>
                  관련 자료를 찾지
                  못했습니다.
                </strong>
              </p>

              <p className="text-empty-scope">
                수집 범위 · 기관{' '}
                {result.scope?.agencies ??
                  25}
                개 · 문서{' '}
                {(
                  result.scope?.documents ??
                  1496
                ).toLocaleString()}
                건
                {result.scope?.period
                  ? ` · 기간 ${result.scope.period}`
                  : ''}
                {result.scope?.note
                  ? ` · ${result.scope.note}`
                  : ' · 기관별 수집 시점이 다릅니다'}
              </p>

              <p className="text-empty-note">
                현재 수집 범위 밖의
                기관이거나, 해당 시점의
                자료가 아직 수집되지 않았을
                수 있습니다.
              </p>

              <p className="text-empty-warning">
                이 결과만으로 관련 자료가
                존재하지 않거나 입력한 주장이
                거짓이라고 판단할 수
                없습니다.
              </p>
            </div>
          ) : (
            /* 관련 자료 있음 */
            <div className="text-card-list">
              {evidence.map(
                (item, index) => {
                  const coverage =
                    item.coverage || {
                      hit: 0,
                      total: 0,
                    };

                  const coverageClass =
                    coverage.total > 0
                      ? coverage.hit ===
                        coverage.total
                        ? 'full'
                        : 'part'
                      : '';

                  const hasCheckItems =
                    CLAIM_KINDS.some(
                      (kind) =>
                        (item.matched?.[
                          kind
                        ]?.length || 0) +
                          (item.missing?.[
                            kind
                          ]?.length || 0) >
                        0,
                    );

                  const sourceText =
                    item.display_text ||
                    item.chunk_text ||
                    '';

                  return (
                    <article
                      className={`text-evidence-card ${
                        selected === index
                          ? 'selected'
                          : ''
                      }`}
                      key={`${
                        item.url ||
                        item.title
                      }-${index}`}
                    >
                      {/* 카드 상단 */}
                      <button
                        type="button"
                        className="text-card-top"
                        onClick={() =>
                          setSelected(index)
                        }
                      >
                        <span
                          className={`text-coverage ${coverageClass}`}
                        >
                          {coverage.total
                            ? `구절 일치 항목 ${coverage.hit}개`
                            : '관련 자료'}
                        </span>

                        <div className="text-card-kicker">
                          {selected ===
                          index
                            ? '현재 비교 중'
                            : `관련 자료 ${
                                index + 1
                              }`}
                        </div>

                        <div className="text-source">
                          {item.source ||
                            '출처 미상'}
                        </div>

                        <div className="text-title">
                          {item.title ||
                            '제목 없음'}
                        </div>

                        <div className="text-dates">
                          <div>
                            발행일{' '}
                            {item.published_date ||
                              '—'}
                          </div>

                          <div className="text-date-basis">
                            └{' '}
                            {item.date_basis ||
                              '출처 미확인'}
                          </div>

                          <div>
                            본문 기준일{' '}
                            {item.as_of ||
                              '—'}
                          </div>
                        </div>
                      </button>

                      {/* 원문 구절 */}
                      <div className="text-quote-section">
                        <div className="text-quote-label">
                          주장과 대조할 원문
                          구절
                        </div>

                        <div
                          className={`text-quote ${
                            sourceText.length >
                            650
                              ? 'long'
                              : ''
                          }`}
                        >
                          <MarkedText
                            text={sourceText}
                            terms={flatten(
                              item.matched,
                            )}
                          />
                        </div>
                      </div>

                      {/* 선택 구절의 일치 항목 */}
                      {(item.missing?.기관?.length || item.missing?.사업명?.length) ? <p className="text-extraction-warning">기관 또는 사업명이 일치하지 않습니다. 수치가 같아도 다른 사건일 수 있습니다.</p> : null}
                      {hasCheckItems && (
                        <div className="text-check">
                          <div className="text-check-title">
                            선택 구절의 일치
                            항목
                          </div>

                          {CLAIM_KINDS.map(
                            (kind) => {
                              const hit =
                                item.matched?.[
                                  kind
                                ] || [];

                              const miss =
                                item.missing?.[
                                  kind
                                ] || [];

                              if (
                                !hit.length &&
                                !miss.length
                              ) {
                                return null;
                              }

                              return (
                                <div
                                  className="text-check-row"
                                  key={kind}
                                >
                                  <span className="text-check-key">
                                    {kind}
                                  </span>

                                  <span className="text-check-value">
                                    {hit.length >
                                      0 && (
                                      <span className="text-hit">
                                        {hit.join(
                                          ' · ',
                                        )}
                                      </span>
                                    )}

                                    {hit.length >
                                      0 &&
                                      miss.length >
                                        0 && (
                                        <span className="text-check-separator">
                                          {' '}
                                          /{' '}
                                        </span>
                                      )}

                                    {miss.length >
                                      0 && (
                                      <span className="text-miss">
                                        {miss.join(
                                          ' · ',
                                        )}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            },
                          )}
                        </div>
                      )}

                      {/* 카드 하단 */}
                      <footer className="text-card-footer">
                        <span className="text-result-number">
                          관련 자료{' '}
                          {index + 1}
                        </span>

                        {item.url ? (
                          <a
                            className="text-original-link"
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            원문 더보기 →
                          </a>
                        ) : (
                          <span className="text-muted">
                            원문 링크 없음
                          </span>
                        )}
                      </footer>
                    </article>
                  );
                },
              )}
            </div>
          )}
        </section>
      </div>

      {/* ========================================
          연구·추적 기록
      ======================================== */}
      {result.research && (
        <details className="text-research">
          <summary>
            연구·추적 기록 보기 (일반 사용자
            검토용 아님)
          </summary>

          <p>
            아래 값은 검색 및 모델 동작을
            확인하기 위한 연구·추적용
            기록입니다. 일반 사용자에게 사실
            여부를 판단하는 점수로 제공하지
            않습니다.
          </p>

          <div className="text-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>관련 후보</th>
                  <th>검색 유사도</th>
                  <th>함의</th>
                  <th>중립</th>
                  <th>모순</th>
                </tr>
              </thead>

              <tbody>
                {(
                  result.research
                    .candidates || []
                ).map(
                  (
                    candidate,
                    index,
                  ) => (
                    <tr key={index}>
                      <td>
                        {candidate.rank}
                      </td>

                      <td>
                        {candidate.candidate_relevant
                          ? '○'
                          : '×'}
                      </td>

                      <td>
                        {Number(
                          candidate.dense_score ??
                            0,
                        ).toFixed(4)}
                      </td>

                      <td>
                        {Number(
                          candidate.p_entail ??
                            0,
                        ).toFixed(4)}
                      </td>

                      <td>
                        {Number(
                          candidate.p_neutral ??
                            0,
                        ).toFixed(4)}
                      </td>

                      <td>
                        {Number(
                          candidate.p_contradiction ??
                            0,
                        ).toFixed(4)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}