
import {
  CLAIM_KINDS,
  type ClaimComponents,
  type NormalizedTextResult,
  type TextEvidence,
  type TextPredictResponse,
} from '../types/text';

// The first request also initializes the text models on the backend.
const API_TIMEOUT_MS = 180_000;

// 금액 범위와 기간 길이를 별도 수치 항목으로 보존한다.
// 연도(2026년)와 기간 길이(16년)는 서로 다른 의미이므로 구분한다.
const NUMBER_CORE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const NUMBER_UNIT = String.raw`(?:\s*(?:억|조|만)\s*)?(?:원|명|개|건|가구|대|톤|달러|불|곳|개소|배|점|차례|회|종|ha|㎡|㎞|km|mg|도|%|％)(?:\s*p)?`;
const RANGE_SEPARATOR = String.raw`(?:~|～|∼|–|—|-)`;
const NUMBER_PATTERN = String.raw`(?:${NUMBER_CORE}\s*(?:${NUMBER_UNIT})?\s*${RANGE_SEPARATOR}\s*${NUMBER_CORE}\s*${NUMBER_UNIT}|${NUMBER_CORE}\s*${NUMBER_UNIT})`;
const DURATION_PATTERN = String.raw`(?:${NUMBER_CORE}\s*${RANGE_SEPARATOR}\s*${NUMBER_CORE}|${NUMBER_CORE})\s*(?:년|개월|주|일|시간)(?:째|간|동안)?`;
const TRACK_PATTERN = String.raw`(?:${NUMBER_PATTERN}|${DURATION_PATTERN})`;
export const NUM = new RegExp(NUMBER_PATTERN, 'g');

export interface NumericOccurrence {
  value: string;
  start: number;
  end: number;
  context: string;
  sentence: string;
  label: string;
  isRange: boolean;
  category: '수치' | '기간 길이';
}

// 달력 날짜의 '일'은 지속 기간이 아니다. 먼저 날짜 전체의 위치를 확보해
// '2026년 5월 19일' / '3월 13일' 내부의 '19일' / '13일'을 제외한다.
// '3일간', '16년째' 등 실제 기간 표현은 날짜 영역 밖에서 계속 추적한다.
function calendarDateSpans(text: string): Array<{ start: number; end: number }> {
  const datePattern = /(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/g;
  return [...text.matchAll(datePattern)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

export function extractNumericOccurrences(text: string): NumericOccurrence[] {
  const dateSpans = calendarDateSpans(text);
  const pattern = new RegExp(TRACK_PATTERN, 'g');
  const occurrences: NumericOccurrence[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    // 날짜 내부에 포함된 수치·기간 표현은 독립된 추적 항목으로 중복 추출하지 않는다.
    if (dateSpans.some((date) => start < date.end && end > date.start)) continue;
    const value = match[0].trim();
    // 2026년, 2026년도처럼 네 자리 연도는 기간 길이로 취급하지 않는다.
    if (/^20\d{2}\s*년(?:도)?$/.test(value)) continue;
    // '2026년' 내부에 겹치는 부분 문자열을 기간 길이로 오인하지 않는다.
    if (start > 0 && /[\d]/.test(text[start - 1])) continue;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const left = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1;
    const rightCandidates = [after.indexOf('.'), after.indexOf('!'), after.indexOf('?'), after.indexOf('\n')].filter((n) => n >= 0);
    const right = rightCandidates.length ? end + Math.min(...rightCandidates) + 1 : text.length;
    const sentence = text.slice(left, right).trim();
    const prefix = text.slice(left, start).trim().replace(/[,;:]\s*$/, '');
    const category = new RegExp(String.raw`^${DURATION_PATTERN}$`).test(value) ? '기간 길이' : '수치';
    occurrences.push({
      value, start, end, sentence,
      label: prefix.slice(-45) || '항목명 확인 필요',
      context: text.slice(Math.max(0, start - 45), Math.min(text.length, end + 45)),
      isRange: new RegExp(String.raw`^${NUMBER_CORE}\s*(?:${NUMBER_UNIT})?\s*${RANGE_SEPARATOR}\s*${NUMBER_CORE}`).test(value),
      category,
    });
  }
  return occurrences;
}

const PER =
  /['’]?\d{2,4}\s*년\s*\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?|\d{4}\s*년(?:도)?|['’]\d{2}\s*\.\s*\d{1,2}(?:\s*\.\s*\d{1,2})?|\d{1,2}\s*월\s*\d{1,2}\s*일|제?\s*\d\s*분기|상반기|하반기/g;

const TGT =
  /[「『"“']([^」』"”']{2,30})[」』"”']|([가-힣A-Za-z0-9·\-]{2,20}(?:제도|사업|센터|위원회|기금|법|협약|지원금|계획|정책|서비스))/g;

const AGENCY =
  /(?:중소벤처기업부|행정안전부|보건복지부|교육부|기획재정부|재정경제부|산업통상자원부|산업통상부|과학기술정보통신부|고용노동부|국토교통부|농림축산식품부|문화체육관광부|환경부|법무부|외교부|통일부|국방부|해양수산부|식품의약품안전처|질병관리청|통계청|국세청|관세청|조달청|경찰청|소방청|산림청|기상청|금융위원회|공정거래위원회|국가보훈부|방송통신위원회)/g;

const PROJECT =
  /[「『‘'"]([^」』’'"]{2,60})[」』’'"]/g;

const uniq = (values: string[]): string[] =>
  [...new Set(
    values
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  )];

const nz = (value: string): string =>
  String(value)
    .normalize('NFKC')
    .replace(/[\s,]/g, '');

export function extractComponents(
  claim: string,
): ClaimComponents {
  const targets: string[] = [];
  const projects: string[] = [];

  let match: RegExpExecArray | null;

  TGT.lastIndex = 0;

  while ((match = TGT.exec(claim))) {
    targets.push(match[1] || match[2]);
  }

  PROJECT.lastIndex = 0;

  while ((match = PROJECT.exec(claim))) {
    projects.push(match[1]);
  }

  return {
    수치: uniq(claim.match(NUM) || []),
    기간: uniq(claim.match(PER) || []),
    대상: uniq(targets),
    기관: uniq(claim.match(AGENCY) || []),
    사업명: uniq(projects),
  };
}

function decodeEntities(text: string): string {
  const element = document.createElement('textarea');
  element.innerHTML = text;
  return element.value;
}

function cleanSourceText(raw = ''): string {
  let text = String(raw)
    .replace(/\\(?=<\/?[a-zA-Z])/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<t[dh][^>]*>/gi, '')
    .replace(/<[^>]*>/g, '');

  text = decodeEntities(text);

  if (/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/.test(text)) {
    text = decodeEntities(text);
  }

  return text
    .replace(/\\+/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function compare(
  comps: ClaimComponents,
  chunk: string,
) {
  const haystack = nz(chunk);

  const matched = {} as ClaimComponents;
  const missing = {} as ClaimComponents;

  let hit = 0;
  let total = 0;

  for (const kind of CLAIM_KINDS) {
    const items = comps[kind] || [];

    matched[kind] = items.filter(
      (item) => nz(item) && haystack.includes(nz(item)),
    );

    missing[kind] = items.filter(
      (item) => !matched[kind].includes(item),
    );

    hit += matched[kind].length;
    total += items.length;
  }

  return {
    matched,
    missing,
    hit,
    total,
  };
}

/**
 * 날짜를 YYYY-MM-DD 또는 MM-DD 형식으로 정규화한다.
 * 연도가 없는 날짜에는 연도를 임의로 부여하지 않는다.
 */
function normalizeDate(
  yearText: string | undefined,
  monthText: string,
  dayText: string,
): string | undefined {
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return undefined;
  }

  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return undefined;
  }

  const monthPart = String(month).padStart(2, '0');
  const dayPart = String(day).padStart(2, '0');

  if (!yearText) {
    // 윤년 여부를 알 수 없는 경우 2월 29일까지 허용한다.
    const maxDays = new Date(2024, month, 0).getDate();

    if (day > maxDays) {
      return undefined;
    }

    return `${monthPart}-${dayPart}`;
  }

  let year = Number(yearText.replace(/['’‘]/g, ''));

  if (yearText.replace(/['’‘]/g, '').length === 2) {
    year += 2000;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return `${year}-${monthPart}-${dayPart}`;
}

/**
 * 명시적으로 "기준", "현재", "까지" 등과 연결된
 * 본문 기준일만 추출한다.
 *
 * 단순 행사 개최일이나 보도일은 as_of로 취급하지 않는다.
 */
export function extractAsOf(
  text: string,
): string | undefined {
  if (!text.trim()) {
    return undefined;
  }

  const datePattern =
    String.raw`(?:(?<year>20\d{2}|['’‘]\d{2})\s*(?:년\s*|[./-]\s*))?` +
    String.raw`(?<month>0?[1-9]|1[0-2])\s*(?:월\s*|[./-]\s*)` +
    String.raw`(?<day>0?[1-9]|[12]\d|3[01])\s*(?:일)?`;

  const suffixPattern =
    String.raw`(?:\s*\([월화수목금토일]\))?` +
    String.raw`\s*(?:24\s*시\s*)?` +
    String.raw`(?:를?\s*)?(?:기준|현재|까지)\b?`;

  const pattern = new RegExp(
    datePattern + suffixPattern.replace(/\\b\?$/, ''),
    'g',
  );

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const groups = match.groups;

    if (!groups) {
      continue;
    }

    const normalized = normalizeDate(
      groups.year,
      groups.month,
      groups.day,
    );

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function basisOf(source?: string): string {
  const map: Record<string, string> = {
    regex: '원문 본문에서 추출',
    content_regex: '원문 본문에서 추출',
    unverified: '날짜 출처 항목 미확인',
    generic: '크롤링 시점 (신뢰 낮음)',
  };

  const key = String(source || '').toLowerCase();

  return map[key] || source || '출처 미확인';
}

function normalize(
  response: TextPredictResponse,
  claim: string,
): NormalizedTextResult {
  const local = extractComponents(claim);
  const server = response.claim_components;

  const comps = CLAIM_KINDS.reduce((acc, kind) => {
    acc[kind] = uniq([
      ...(server?.[kind] || []),
      ...local[kind],
    ]);

    return acc;
  }, {} as ClaimComponents);

  const seen = new Set<string>();

  const evidence = (response.evidence || [])
    .map((item, index) => ({
      ...item,
      rank: item.rank ?? index + 1,
    }))
    .filter((item) => {
      const url = (item.url || '').trim().toLowerCase();

      const key = url
        ? `url:${url}`
        : `doc:${(item.source || '').trim().toLowerCase()}|${(
            item.title || ''
          ).trim().toLowerCase()}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((item: TextEvidence) => {
      const displayText = cleanSourceText(
        item.chunk_text || item.display_text || '',
      );

      const comparison = compare(comps, displayText);

      return {
        ...item,
        display_text: displayText,
        matched: comparison.matched,
        missing: comparison.missing,
        coverage: {
          hit: comparison.hit,
          total: comparison.total,
        },
        as_of:
          item.as_of ||
          extractAsOf(displayText),
        date_basis:
          item.date_basis ||
          basisOf(item.date_source),
      };
    });

  // 기존 구절 일치도 기반 정렬을 유지한다.
  // 날짜를 이용한 재정렬(C4)은 적용하지 않는다.
  evidence.sort(
    (a, b) =>
      (b.coverage?.hit ?? 0) -
        (a.coverage?.hit ?? 0) ||
      (a.rank ?? 0) - (b.rank ?? 0),
  );

  return {
    status:
      response.status ||
      response.result ||
      'insufficient_material',
    claim,
    comps,
    evidence,
    scope: response.scope,
    research: response.research,
    message: response.message,
  };
}

export async function analyzeText(
  sentence: string,
  signal?: AbortSignal,
): Promise<NormalizedTextResult> {
  const base = (
    import.meta.env.VITE_TEXT_API_BASE_URL ||
    '/api/text'
  ).replace(/\/$/, '');

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, API_TIMEOUT_MS);

  const abortHandler = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortHandler, {
      once: true,
    });
  }

  try {
    const response = await fetch(`${base}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentence,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();

    if (!response.ok) {
      if (response.status === 502) {
        throw new Error(
          '텍스트 백엔드에 연결하지 못했습니다 (HTTP 502). 백엔드 실행 상태와 Vite 프록시 설정을 확인해 주세요.',
        );
      }

      if (response.status === 503) {
        throw new Error(
          '텍스트 백엔드가 현재 요청을 처리할 수 없습니다 (HTTP 503). 잠시 후 다시 시도해 주세요.',
        );
      }

      let serverMessage = '';

      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          serverMessage = parsed.error || parsed.message || '';
        } catch {
          // 서버가 HTML이나 일반 텍스트를 반환할 수도 있다.
        }
      }

      throw new Error(
        serverMessage ||
          `텍스트 API 서버 오류 (HTTP ${response.status})`,
      );
    }

    if (!raw.trim()) {
      throw new Error(
        '텍스트 API 서버가 빈 응답을 반환했습니다. 백엔드 로그를 확인해 주세요.',
      );
    }

    let body: TextPredictResponse;

    try {
      body = JSON.parse(raw) as TextPredictResponse;
    } catch {
      throw new Error(
        '텍스트 API 응답이 올바른 JSON 형식이 아닙니다.',
      );
    }

    if (!body || typeof body !== 'object') {
      throw new Error(
        '텍스트 API 응답 형식이 올바르지 않습니다.',
      );
    }

    if (body.error) {
      throw new Error(body.error);
    }

    return normalize(body, sentence);
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      throw new Error(
        signal?.aborted
          ? '분석 요청이 취소되었습니다.'
          : `텍스트 서버가 ${API_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다. 서버 초기 기동·모델 로딩 상태와 Modal 로그를 확인해 주세요.`,
      );
    }

    if (error instanceof TypeError) {
      throw new Error(
        '텍스트 API 서버에 연결할 수 없습니다. 백엔드 실행 상태와 프록시 설정을 확인해 주세요.',
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortHandler);
  }
}
