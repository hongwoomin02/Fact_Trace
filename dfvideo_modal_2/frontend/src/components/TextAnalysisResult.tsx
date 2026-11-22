
import { Fragment, useEffect, useState } from 'react';

import {
  CLAIM_KINDS,
  type BodyDate,
  type NormalizedTextResult,
  type TextEvidence,
} from '../types/text';

import { extractNumericOccurrences } from '../services/textApi';
import { extractClaimAgencyNames, findAgencyRelation } from '../services/governmentAgencies';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    ...terms.map(
      (value) => [value, 'hit'] as const,
    ),
    ...missTerms.map(
      (value) => [value, 'miss'] as const,
    ),
  ]
    .filter(
      ([value], index, array) =>
        value &&
        array.findIndex(
          ([other]) => other === value,
        ) === index,
    )
    .sort(
      (a, b) => b[0].length - a[0].length,
    );

  if (!all.length) {
    return <>{text}</>;
  }

  const pattern = new RegExp(
    `(${all.map(([value]) => escapeRegex(value)).join('|')})`,
    'g',
  );

  return (
    <>
      {text.split(pattern).map((part, index) => {
        const found = all.find(
          ([value]) => value === part,
        );

        if (!found) {
          return (
            <Fragment key={index}>
              {part}
            </Fragment>
          );
        }

        return (
          <mark
            key={index}
            className={`text-${found[1]}`}
          >
            {part}
          </mark>
        );
      })}
    </>
  );
}

// 숫자는 백엔드의 문자열 일치 결과를 그대로 사용하지 않고,
// 현재 화면에 표시한 근거 구절에서 수치+단위 전체를 다시 확인한다.
// 범위 기호와 공백의 표기 차이만 허용하며, 19원과 19~21원은 구분한다.
function numericKey(value: string): string {
  const compact = value.normalize('NFKC')
    .replace(/[～∼–—-]/g, '~')
    .replace(/[\s,]/g, '')
    .replace(/％/g, '%');

  // 19원~21원 / 19 ~ 21원 -> 19~21원.
  // 단위가 서로 다른 범위는 자동 일치시키지 않는다.
  const range = compact.match(/^(\d+(?:\.\d+)?)([^\d~]*?)~(\d+(?:\.\d+)?)([^\d~]+)$/);
  if (range) {
    const [, first, firstUnit, last, lastUnit] = range;
    if (!firstUnit || firstUnit === lastUnit) {
      return `${first}~${last}${lastUnit}`;
    }
  }
  return compact;
}

function compareVisibleNumbers(claimNumbers: string[], sourceText: string) {
  const sourceKeys = new Set(
    extractNumericOccurrences(sourceText)
      .filter(item => item.category === '수치')
      .map(item => numericKey(item.value)),
  );
  return {
    hit: claimNumbers.filter(value => sourceKeys.has(numericKey(value))),
    miss: claimNumbers.filter(value => !sourceKeys.has(numericKey(value))),
  };
}

// 기간 길이는 달력 연도와 별개로 원문에서 추출하여 비교한다.
// 16년째와 16년간은 수치·단위가 같아도 의미가 다를 수 있어 자동 일치시키지 않는다.
function durationKey(value: string): string {
  return value.normalize('NFKC')
    .replace(/[～∼–—-]/g, '~')
    .replace(/[\s,]/g, '')
    .replace(/동안$/, '간');
}

function compareVisibleDurations(claimText: string, sourceText: string) {
  const claim = extractNumericOccurrences(claimText).filter(item => item.category === '기간 길이');
  const sourceKeys = new Set(
    extractNumericOccurrences(sourceText)
      .filter(item => item.category === '기간 길이')
      .map(item => durationKey(item.value)),
  );
  const values = [...new Set(claim.map(item => item.value))];
  return {
    hit: values.filter(value => sourceKeys.has(durationKey(value))),
    miss: values.filter(value => !sourceKeys.has(durationKey(value))),
  };
}

function dateRoleLabel(role: string): string {
  switch (role) {
    case 'as_of':
      return '본문 기준일';

    case 'publication':
      return '발표·보도 관련 날짜';

    case 'event':
      return '행사·시행 관련 날짜';

    case 'year_reference':
      return '성과·사업 관련 연도';

    case 'unspecified':
      return '용도 미확인';

    default:
      return '기타 날짜';
  }
}

function formatBodyDate(value: string): string {
  const normalized = value.trim();

  if (/^\d{4}$/.test(normalized)) {
    return `${normalized}년`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized} (연도 미확인)`;
  }

  return normalized;
}

function getBodyDates(
  evidence: TextEvidence,
): BodyDate[] {
  const dates = Array.isArray(evidence.body_dates)
    ? evidence.body_dates
    : [];

  const seen = new Set<string>();

  return dates.filter((item) => {
    if (
      !item ||
      typeof item.date !== 'string' ||
      !item.date.trim()
    ) {
      return false;
    }

    const key = `${item.date}|${item.role}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

// 주장 속 날짜는 발표일, 통계 기준일, 행사 시작·종료일로 나누어 비교한다.
// 연도 없는 월·일에는 공식자료의 연도를 임의로 채우지 않는다.
type ClaimDateRole = 'publication' | 'as_of' | 'event_start' | 'event_end' | 'event' | 'other';
type ClaimDateCheck = {
  original: string;
  normalized: string;
  role: ClaimDateRole;
  status: 'matched' | 'unverified';
};
function normalizeCalendarDate(raw: string): string {
  const m = raw.trim().match(/^(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일$/);
  if (!m) return raw.trim();
  const month = m[2].padStart(2, '0');
  const day = m[3].padStart(2, '0');
  return m[1] ? `${m[1]}-${month}-${day}` : `${month}-${day}`;
}
function dateCheckRoleLabel(role: ClaimDateRole): string {
  switch (role) {
    case 'publication': return '발표·보도 관련 날짜';
    case 'as_of': return '통계·본문 기준일';
    case 'event_start': return '행사·모집 시작일';
    case 'event_end': return '행사·모집 종료일';
    case 'event': return '행사·시행 관련 날짜';
    default: return '날짜 용도 미확인';
  }
}
function dateCheckStatusLabel(item: ClaimDateCheck): string {
  if (item.status !== 'matched') return '근거 미확인';
  if (item.role === 'publication') return '발행일 일치';
  if (item.role === 'as_of') return '표현 일치';
  return '표현 일치';
}
// 날짜 표현이 확인된 경우 날짜 값만 강조한다. 역할과 확인 상태는 중립색으로 표시한다.

function compareClaimDates(claim: string, evidence?: TextEvidence): ClaimDateCheck[] {
  if (!evidence) return [];
  const pattern = /(?:(?:\d{4})년\s*)?\d{1,2}월\s*\d{1,2}일/g;
  const results: ClaimDateCheck[] = [];
  for (const match of claim.matchAll(pattern)) {
    const original = match[0];
    const normalized = normalizeCalendarDate(original);
    const start = match.index ?? 0;
    const after = claim.slice(start + original.length, start + original.length + 26);
    const before = claim.slice(Math.max(0, start - 18), start);
    let role: ClaimDateRole = 'other';
    if (/^\s*(?:부터|에서부터|시작(?:해|하여|하는|일)?)/.test(after)) {
      role = 'event_start';
    } else if (/^\s*(?:까지|에\s*종료|종료|마감)/.test(after)) {
      role = 'event_end';
    } else if (/^\s*(?:에\s*)?(?:발표|보도|공개|발행)/.test(after) || /(?:발표|보도|공개|발행)\s*(?:일|날짜|시점)?\s*$/.test(before)) {
      role = 'publication';
    } else if (/^\s*(?:을|를|의|자로|자에)?\s*(?:기준|현재|당시)/.test(after)) {
      role = 'as_of';
    } else if (/^\s*(?:에\s*)?(?:개최|진행|시행|실시|접수)/.test(after)) {
      role = 'event';
    }

    const published = evidence.published_date?.trim().slice(0, 10) || '';
    const asOf = evidence.as_of?.trim() || '';
    const bodyDates = Array.isArray(evidence.body_dates) ? evidence.body_dates : [];
    const bodyAsOf = bodyDates.filter(item => item.role === 'as_of').map(item => item.date);
    const bodyEvents = bodyDates.filter(item => item.role === 'event').map(item => item.date);
    const matched = role === 'publication'
      ? normalized.length === 10 && normalized === published
      : role === 'as_of'
        ? normalized === asOf || bodyAsOf.includes(normalized)
        : role === 'event_start' || role === 'event_end' || role === 'event'
          ? bodyEvents.includes(normalized)
          : false;
    results.push({ original, normalized, role, status: matched ? 'matched' : 'unverified' });
  }
  return results;
}

function EvidenceDates({
  evidence,
}: {
  evidence: TextEvidence;
}) {
  const bodyDates = getBodyDates(evidence);
  const asOf = evidence.as_of?.trim() || '';
  const published = evidence.published_date?.trim() || '';

  // 백엔드가 제공한 날짜 역할을 그대로 사용하되, 같은 날짜가
  // 발행일과 본문 날짜로 중복 노출되는 경우에는 발행일을 우선한다.
  // 연도 없는 날짜는 발행일의 연도를 추정하여 채우지 않는다.
  const asOfDates = bodyDates.filter((item) => item.role === 'as_of');
  const confirmedAsOf = asOf || (asOfDates.length === 1 ? asOfDates[0].date : '');
  const otherDates = bodyDates
    .filter((item) => item.role !== 'as_of')
    .filter((item) => !confirmedAsOf || item.date !== confirmedAsOf)
    .filter((item) => !(item.role === 'publication' && item.date === published))
    .filter((item, index, items) => {
      const priority = (role: string) => {
        if (role === 'event') return 3;
        if (role === 'publication') return 2;
        if (role === 'year_reference') return 1;
        return 0;
      };
      const best = Math.max(...items
        .filter((other) => other.date === item.date)
        .map((other) => priority(other.role)));
      return priority(item.role) === best && items.findIndex(
        (other) => other.date === item.date && priority(other.role) === best,
      ) === index;
    });

  return (
    <div className="text-dates">
      <div>
        <strong>자료 발행일</strong>{' '}
        {published || '확인되지 않음'}
      </div>
      <div className="text-date-basis">
        └ {evidence.date_basis || '발행일 출처 미확인'} · 발행일은 통계 기준일이 아닙니다.
      </div>

      <div style={{ marginTop: 7 }}>
        <strong>통계·본문 기준일</strong>{' '}
        {confirmedAsOf ? formatBodyDate(confirmedAsOf) : '확인되지 않음'}
      </div>
      <div className="text-date-basis">
        └ {confirmedAsOf
          ? '본문에서 기준 시점으로 분류된 날짜입니다. 실제 지표·대상과 연결되는지 원문을 확인해 주세요.'
          : '명시적인 단일 기준일을 확인하지 못했습니다. 발행일로 대체하지 않습니다.'}
      </div>

      {otherDates.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            본문에서 확인된 다른 날짜
          </div>
          {otherDates.map((item, index) => (
            <div key={`${item.date}-${item.role}-${index}`}
              style={{ marginTop: 3, lineHeight: 1.6 }}>
              {formatBodyDate(item.date)} · {dateRoleLabel(item.role)}
              {item.explicit_year === false && !/^\d{2}-\d{2}$/.test(item.date)
                ? ' · 연도 확인 필요' : ''}
            </div>
          ))}
          <div className="text-date-basis">
            └ 행사·발표일 및 연도 미확인 날짜는 통계 기준일과 별도로 취급합니다.
          </div>
        </div>
      )}
      {bodyDates.length === 0 && (
        <div className="text-date-basis">└ 본문 날짜 정보가 추가로 제공되지 않았습니다.</div>
      )}
    </div>
  );
}

function ResearchTable({
  research,
}: {
  research: NonNullable<
    NormalizedTextResult['research']
  >;
}) {
  return (
    <details className="text-research">
      <summary>
        연구·추적 기록 보기 (일반 사용자 검토용 아님)
      </summary>

      <p>
        아래 값은 검색 및 모델 동작을 확인하기
        위한 연구·추적용 기록입니다.
        일반 사용자에게 사실 여부를 판단하는
        점수로 제공하지 않습니다.
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
            {(research.candidates || []).map(
              (candidate, index) => (
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
                      candidate.dense_score ?? 0,
                    ).toFixed(4)}
                  </td>

                  <td>
                    {Number(
                      candidate.p_entail ?? 0,
                    ).toFixed(4)}
                  </td>

                  <td>
                    {Number(
                      candidate.p_neutral ?? 0,
                    ).toFixed(4)}
                  </td>

                  <td>
                    {Number(
                      candidate.p_contradiction ?? 0,
                    ).toFixed(4)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function TextAnalysisResult({
  result,
}: {
  result: NormalizedTextResult;
}) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [result]);

  const evidence = result.evidence;

  const found =
    result.status === 'evidence_found' &&
    evidence.length > 0;

  const selectedEvidence =
    evidence[selected] || evidence[0];

  const selectedNumericComparison = compareVisibleNumbers(
    result.comps['수치'] || [],
    selectedEvidence?.display_text || selectedEvidence?.chunk_text || '',
  );
  const selectedDurationComparison = compareVisibleDurations(result.claim, selectedEvidence?.display_text || selectedEvidence?.chunk_text || '');
  const selectedDateChecks = compareClaimDates(result.claim, selectedEvidence);
  const dateOriginals = new Set(selectedDateChecks.map(item => item.original));
  const hits = [
    ...CLAIM_KINDS.filter(kind => kind !== '수치').flatMap(
      kind => (selectedEvidence?.matched?.[kind] || []).filter(value => !dateOriginals.has(value)),
    ),
    ...selectedDateChecks.filter(item => item.status === 'matched').map(item => item.original),
    ...selectedNumericComparison.hit,
    ...selectedDurationComparison.hit,
  ];

  const selectedSourceText = selectedEvidence?.display_text || selectedEvidence?.chunk_text || '';
  const claimAgencyNames = extractClaimAgencyNames(result.claim, result.comps['기관'] || []);
  const selectedAgencyRelations = claimAgencyNames
    .map(name => findAgencyRelation(name, selectedSourceText, selectedEvidence?.source))
    .filter((relation): relation is NonNullable<typeof relation> => Boolean(relation));
  const selectedAgencyNames = new Set(selectedAgencyRelations.map(relation => relation.claimName));
  const misses = CLAIM_KINDS.flatMap(
    (kind) => (result.comps[kind] || []).filter((value) => {
      if (dateOriginals.has(value)) return false;
      if (hits.includes(value)) return false;
      if (kind === '수치') return selectedNumericComparison.miss.includes(value);
      if (kind === '기관' && selectedAgencyNames.has(value)) return false;
      return true;
    }),
  );

  const numericItems = result.comps['수치'] || [];

  const numericOccurrences = extractNumericOccurrences(result.claim);
  const claimDurations = numericOccurrences.filter(item => item.category === '기간 길이');
  const numericSourceCount = numericOccurrences.length;
  const numericKinds = new Set(numericOccurrences.map((item) => item.value.replace(/\s+/g, ''))).size;

  return (
    <div className="text-results">
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
              ? `현재 수집 범위에서 관련 공식자료 후보 ${evidence.length}건을 찾았습니다. 동일한 사건·지표·기준 시점의 자료인지 확인한 후 직접 비교해 주세요.`
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
        <section>
          <h2>입력한 주장</h2>

          <div className="text-panel text-claim">
            <div className="text-claim-content">
              <MarkedText
                text={result.claim}
                terms={hits}
                missTerms={
                  selectedEvidence
                    ? [...misses, ...selectedDurationComparison.miss]
                    : []
                }
              />
            </div>

            {evidence.length > 0 && (
              <p className="text-interpretation-note">
                강조 색상은 선택한 자료 구절에서 동일한 표현을 찾았는지를 나타냅니다. 빨간색은 해당 구절에서 표현을 찾지 못했다는 뜻이며, 실제 수치 불일치나 다른 사건이라는 판정이 아닙니다.
                수치나 표현의 일치만으로 주장 전체의 참·거짓을 확정하지 않습니다.
                기준 시점이 확인되지 않으면 시점 일치 여부도 판단할 수 없습니다.
              </p>
            )}

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

                {numericSourceCount > 0 && (
                  <p className="text-extraction-warning">
                    원문 수치·기간 길이 등장 {numericSourceCount}건 · 서로 다른 표기 {numericKinds}종 ·
                    일반 수치 비교 목록 {numericItems.length}종. 기간 길이는 연도와 구분해 아래 추적 목록에 표시합니다. 같은 숫자가 반복되어도 서로 다른 항목일 수 있습니다.
                    아래에서 원문별 위치를 확인하세요.
                  </p>
                )}

                {selectedDateChecks.length > 0 && (
                  <div className="text-check-help" role="note">
                    <strong>날짜 역할별 대조</strong>
                    {selectedDateChecks.map((item, index) => (
                      <div key={`${item.original}-${index}`}>
                        <span className={item.status === 'matched' ? 'text-hit' : 'text-agency-neutral'}>
                          {item.original}
                        </span>
                        <span className="text-agency-status"> · {dateCheckRoleLabel(item.role)} ({dateCheckStatusLabel(item)})</span>
                      </div>
                    ))}
                    <small>날짜 표현의 일치는 동일 사건·일정의 검증을 뜻하지 않습니다. 연도 없는 날짜는 연도를 추정하지 않습니다.</small>
                  </div>
                )}
                <dl>
                  {CLAIM_KINDS.filter(
                    (kind) =>
                      result.comps[kind]?.length,
                  ).map((kind) => (
                    <Fragment key={kind}>
                      <dt>{kind}</dt>
                      <dd>
                        {result.comps[kind].join(
                          ' · ',
                        )}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
                {claimDurations.length > 0 && (
                  <dl>
                    <dt>기간 길이</dt>
                    <dd>{claimDurations.map(item => item.value).join(' · ')}</dd>
                  </dl>
                )}
                {numericOccurrences.length > 0 && (
                  <details className="text-numeric-occurrences">
                    <summary>원문 수치·기간 길이별 항목 확인 ({numericOccurrences.length}건)</summary>
                    <ol>
                      {numericOccurrences.map((item, index) => (
                        <li key={`${item.start}-${index}`}>
                          <strong>항목 {index + 1}: {item.value}</strong> <span>({item.category})</span>
                          {item.isRange && <span> (범위 수치 · 하나의 항목)</span>}
                          <div>앞 문맥(항목 단서): {item.label}</div>
                          <div>원문 문장: {item.sentence}</div>
                          <small>원문 위치: {item.start + 1}~{item.end}번째 문자</small>
                        </li>
                      ))}
                    </ol>
                    <small>항목 단서는 숫자 앞의 문맥으로 자동 표시합니다. 정확한 항목명과 자료의 수치가 같은 지표·시점에 해당하는지는 원문에서 확인해야 합니다. 중복 표기 개수와 실제 비교 항목 수는 다를 수 있습니다.</small>
                  </details>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2>관련 자료에서 확인하기</h2>

          {!evidence.length ? (
            <div className="text-panel text-empty-result">
              <p className="text-empty-title">
                <strong>
                  관련 자료를 찾지 못했습니다.
                </strong>
              </p>

              <p className="text-empty-scope">
                수집 범위
                {result.scope?.agencies != null
                  ? ` · 기관 ${result.scope.agencies}개`
                  : ''}
                {result.scope?.documents != null
                  ? ` · 문서 ${result.scope.documents.toLocaleString()}건`
                  : ''}
                {result.scope?.period
                  ? ` · 기간 ${result.scope.period}`
                  : ''}
                {result.scope?.note
                  ? ` · ${result.scope.note}`
                  : ''}
              </p>

              <p className="text-empty-note">
                현재 수집 범위 밖의 기관이거나,
                해당 시점의 자료가 아직 수집되지
                않았을 수 있습니다.
              </p>

              <p className="text-empty-warning">
                이 결과만으로 관련 자료가
                존재하지 않거나 입력한 주장이
                거짓이라고 판단할 수 없습니다.
              </p>
            </div>
          ) : (
            <div className="text-card-list">
              {evidence.map((item, index) => {
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
                      (item.matched?.[kind]
                        ?.length || 0) +
                        (item.missing?.[kind]
                          ?.length || 0) >
                      0,
                  );

                const sourceText =
                  item.display_text ||
                  item.chunk_text ||
                  '';
                const visibleNumericComparison = compareVisibleNumbers(
                  result.comps['수치'] || [], sourceText,
                );

                // 사용자 입력 -> 근거, 근거 -> 사용자 입력 모두 같은 사전으로 비교.
                const visibleDurationComparison = compareVisibleDurations(result.claim, sourceText);
                const visibleDateChecks = compareClaimDates(result.claim, item);
                const agencyAliasMatches = claimAgencyNames
                  .map(claimName => findAgencyRelation(claimName, sourceText, item.source))
                  .filter((relation): relation is NonNullable<typeof relation> => Boolean(relation));
                const agencyAliasNames = new Set(agencyAliasMatches.map(match => match.claimName));
                const unresolvedAgencyNames = claimAgencyNames.filter(name => !agencyAliasNames.has(name) && !(item.matched?.기관 || []).includes(name));

                return (
                  <article
                    className={`text-evidence-card ${
                      selected === index
                        ? 'selected'
                        : ''
                    }`}
                    key={`${
                      item.url || item.title
                    }-${index}`}
                  >
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
                        {selected === index
                          ? '현재 비교 중'
                          : `관련 자료 ${index + 1}`}
                      </div>

                      <div className="text-source">
                        {item.source ||
                          '출처 미상'}
                      </div>

                      <div className="text-title">
                        {item.title ||
                          '제목 없음'}
                      </div>

                      <EvidenceDates
                        evidence={item}
                      />
                    </button>

                    <div className="text-quote-section">
                      <div className="text-quote-label">
                        주장과 대조할 원문 구절
                      </div>

                      <div
                        className={`text-quote ${
                          sourceText.length > 650
                            ? 'long'
                            : ''
                        }`}
                      >
                        <MarkedText
                          text={sourceText}
                          terms={[
                            ...CLAIM_KINDS.filter(kind => kind !== '수치').flatMap(
                              kind => (item.matched?.[kind] || []).filter(value => !dateOriginals.has(value)),
                            ),
                            ...visibleNumericComparison.hit,
                            ...visibleDurationComparison.hit,
                          ]}
                        />
                      </div>
                    </div>

                    {(hasCheckItems || claimAgencyNames.length > 0 || numericItems.length > 0) && (
                      <div className="text-check">
                        <div className="text-check-title">
                          선택 구절의 일치 항목
                        </div>

                        {claimAgencyNames.length > 0 && (
                          <div className="text-check-row">
                            <span className="text-check-key">기관</span>
                            <span className="text-check-value">
                              {claimAgencyNames.map((name, agencyIndex) => {
                                const relation = agencyAliasMatches.find(match => match.claimName === name);
                                const exact = (item.matched?.기관 || []).includes(name) ||
                                  sourceText.includes(name) || item.source === name;
                                return (
                                  <span key={`${name}-${agencyIndex}`} className="text-agency-item">
                                    {agencyIndex > 0 ? ' · ' : ''}
                                    <span className={relation || exact ? 'text-hit' : 'text-agency-neutral'}>
                                      {relation ? `${name} ↔ ${relation.seenName}` : name}
                                    </span>
                                    <span className="text-agency-status">
                                      {relation ? ' (등록된 명칭 관계)' : exact ? ' (표현 일치)' : ' (관계 확인 필요)'}
                                    </span>
                                  </span>
                                );
                              })}
                            </span>
                          </div>
                        )}
                        {CLAIM_KINDS.filter(kind => kind !== '기관').map(
                          (kind) => {
                            const hit = kind === '수치'
                              ? visibleNumericComparison.hit
                              : (item.matched?.[kind] || []).filter(value => !dateOriginals.has(value));

                            const miss = kind === '수치'
                              ? visibleNumericComparison.miss
                              : (item.missing?.[kind] || []).filter(value => !dateOriginals.has(value));

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
                                  {hit.length > 0 && (
                                    <span className="text-hit">
                                      {hit.join(
                                        ' · ',
                                      )}
                                    </span>
                                  )}

                                  {hit.length > 0 &&
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
                        {visibleDateChecks.length > 0 && (
                          <div className="text-check-row">
                            <span className="text-check-key">날짜 역할</span>
                            <span className="text-check-value">
                              {visibleDateChecks.map((date, index) => (
                                <span key={`${date.original}-${index}`} style={{ display: 'block' }}>
                                  <span className={date.status === 'matched' ? 'text-hit' : 'text-agency-neutral'}>
                                    {date.original}
                                  </span>
                                  <span className="text-agency-status"> · {dateCheckRoleLabel(date.role)} ({dateCheckStatusLabel(date)})</span>
                                </span>
                              ))}
                            </span>
                          </div>
                        )}
                        {(visibleDurationComparison.hit.length > 0 || visibleDurationComparison.miss.length > 0) && (
                          <div className="text-check-row">
                            <span className="text-check-key">기간 길이</span>
                            <span className="text-check-value">
                              {visibleDurationComparison.hit.length > 0 && (
                                <span className="text-hit">{visibleDurationComparison.hit.join(' · ')}</span>
                              )}
                              {visibleDurationComparison.hit.length > 0 && visibleDurationComparison.miss.length > 0 && ' / '}
                              {visibleDurationComparison.miss.length > 0 && (
                                <span className="text-agency-neutral">{visibleDurationComparison.miss.join(' · ')} (선택 구절에서 미확인)</span>
                              )}
                            </span>
                          </div>
                        )}
                        {visibleDurationComparison.miss.length > 0 && (
                          <p className="text-check-help" role="note">
                            기간 길이 확인 필요 · 표시된 원문 구절에서는 해당 기간 표현을 찾지 못했습니다.
                            이는 공식자료 전체에 해당 표현이 없다는 뜻이 아닙니다. 원문 더보기를 통해 전체 문서와 기간의 대상·맥락을 확인해 주세요.
                          </p>
                        )}
                        {agencyAliasMatches.length > 0 && (
                          <p className="text-check-help" role="note">
                            기관명 사전 확인 · {agencyAliasMatches.map(match =>
                              `${match.claimName} ↔ ${match.seenName} (${match.canonical}${match.fromSource ? ' · 출처명 기준' : ' · 본문 기준'})`
                            ).join(' / ')}. 약칭 관계는 동일 사건·지표의 증거가 아닙니다.
                          </p>
                        )}
                        {(unresolvedAgencyNames.length > 0 ||
                          (item.missing?.사업명?.length || 0) > 0) ? (
                          <p className="text-check-help" role="note">
                            기관·사업명 관계 확인 필요 · 등록된 명칭 관계가 없더라도 다른 기관이나
                            사건이라는 뜻은 아닙니다. 기관 개편·명칭 변경·약칭과
                            대상·지표·기준 시점을 원문에서 확인해 주세요.
                          </p>
                        ) : null}
                      </div>
                    )}

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
              })}
            </div>
          )}
        </section>
      </div>

      {result.research && (
        <ResearchTable
          research={result.research}
        />
      )}
    </div>
  );
}
