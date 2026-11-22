/** DB source 기반 기관 표현 사전. 기관 개편 전후의 법적 동일성은 판정하지 않는다. */
export type AgencyCategory = '중앙행정기관' | '공공기관' | '교육행정기관' | '정부 정책포털';
export type AgencyEntry = { source: string; aliases: readonly string[]; category: AgencyCategory; note?: string; reviewAliases?: readonly string[] };

// source는 업로드된 trusted_seed_data_recrawled(1).csv의 고유 source 값과 정확히 일치한다.
// aliases는 검색·표시용 통상 약칭 후보이며, 공식 약칭임을 보증하지 않는다.
export const GOVERNMENT_AGENCIES: readonly AgencyEntry[] = [
  {source:'정책브리핑',aliases:['대한민국 정책브리핑','정책브리핑'],category:'정부 정책포털',note:'여러 기관의 정책을 게재하는 포털로 단일 부처가 아님'},
  {source:'국무조정실',aliases:['국조실'],category:'중앙행정기관'},
  {source:'국민건강보험공단',aliases:['건보공단','건보','건강보험공단','국민건보공단'],category:'공공기관',note:'건보는 일반명사와 겹칠 수 있어 문맥 확인 필요'},
  {source:'교육부',aliases:[],category:'중앙행정기관'},
  {source:'서울특별시교육청',aliases:['서울시교육청','서울교육청'],category:'교육행정기관'},
  {source:'식품의약품안전처',aliases:['식약처'],category:'중앙행정기관'},
  {source:'보건복지부',aliases:['복지부'],category:'중앙행정기관'},
  {source:'기획재정부',aliases:['기재부'],category:'중앙행정기관',note:'역사적 기관명으로 보관. 재정경제부 등 개편 후 기관과 자동 동일시하지 않음'},
  {source:'질병관리청',aliases:['질병청'],category:'중앙행정기관'},
  {source:'경찰청',aliases:[],category:'중앙행정기관'},
  {source:'법무부',aliases:[],category:'중앙행정기관'},
  {source:'공정거래위원회',aliases:['공정위'],category:'중앙행정기관'},
  {source:'법제처',aliases:[],category:'중앙행정기관'},
  {source:'중소벤처기업부',aliases:['중기부','중기벤처부'],category:'중앙행정기관',note:'중기벤처부는 통상 표현 후보로서 공식 약칭 여부 별도 확인'},
  {source:'과학기술정보통신부',aliases:['과기정통부'],reviewAliases:['과기부'],category:'중앙행정기관',note:'과기부는 과거 기관명과 혼동될 수 있어 자동 일치에 사용하지 않음'},
  {source:'개인정보보호위원회',aliases:['개인정보위','개보위','개인정보위원회'],category:'중앙행정기관',note:'개인정보위원회는 비공식 변형 표현 후보'},
  {source:'지식재산처',aliases:['지재처'],category:'중앙행정기관',note:'과거 기관명과의 개편 관계는 별도 확인 필요'},
  {source:'소방청',aliases:[],category:'중앙행정기관'},
  {source:'고용노동부',aliases:['고용부','노동부'],category:'중앙행정기관',note:'노동부는 역사적 명칭일 수도 있으므로 문맥 확인 필요'},
  {source:'국가교육위원회',aliases:['국교위','국가교육위'],category:'중앙행정기관'},
  {source:'행정안전부',aliases:['행안부'],category:'중앙행정기관'},
  {source:'환경부',aliases:[],category:'중앙행정기관',note:'조직 개편 전후 명칭 관계는 별도 확인 필요'},
  {source:'국토교통부',aliases:['국토부'],category:'중앙행정기관'},
  {source:'산업통상자원부',aliases:['산업부'],category:'중앙행정기관',note:'DB의 역사적 source 명칭. 산업통상부 등 후속 명칭과 자동 동일시하지 않음'},
  {source:'기상청',aliases:[],category:'중앙행정기관'},
];

const normalized = (name: string) => name.replace(/\s+/g,'').trim();
const index = new Map<string, AgencyEntry>();
for (const entry of GOVERNMENT_AGENCIES) {
  for (const name of [entry.source, ...entry.aliases]) {
    const key = normalized(name);
    if (!index.has(key)) index.set(key, entry);
  }
}
export function lookupAgency(name: string): AgencyEntry | undefined { return index.get(normalized(name)); }
export function equivalentAgencyNames(a: string, b: string): boolean {
  const left = lookupAgency(a), right = lookupAgency(b);
  return Boolean(left && right && left.source === right.source);
}
export function findAgencyMention(text: string, entry: AgencyEntry): string | undefined {
  return [entry.source, ...entry.aliases].find(name => text.includes(name));
}


/** 검색/본문 양방향 기관 표현 대응. 개편 전후 기관의 동일성을 추정하지 않는다. */
const CONTEXTUAL_NAME_PAIRS: readonly (readonly [string, string])[] = [
  ['산업통상부', '산업부'],
];

export type AgencyRelation = { claimName: string; seenName: string; canonical: string; fromSource: boolean };
export function findAgencyRelation(claimName: string, evidenceText: string, sourceName?: string): AgencyRelation | undefined {
  const agency = lookupAgency(claimName);
  if (agency) {
    const mention = findAgencyMention(evidenceText, agency);
    if (mention && normalized(mention) !== normalized(claimName)) {
      return { claimName, seenName: mention, canonical: agency.source, fromSource: false };
    }
    if (sourceName && equivalentAgencyNames(claimName, sourceName) && normalized(sourceName) !== normalized(claimName)) {
      return { claimName, seenName: sourceName, canonical: agency.source, fromSource: true };
    }
  }
  // 현재 산업통상부/산업부 표현만 본문에서 직접 확인. 과거 DB source
  // '산업통상자원부'를 현재 기관과 자동으로 동일시하지 않는다.
  for (const [full, short] of CONTEXTUAL_NAME_PAIRS) {
    if (normalized(claimName) !== normalized(full) && normalized(claimName) !== normalized(short)) continue;
    const other = normalized(claimName) === normalized(full) ? short : full;
    if (evidenceText.includes(other)) {
      return { claimName, seenName: other, canonical: full, fromSource: false };
    }
  }
  return undefined;
}

/** 백엔드 기관 추출 누락 시에도 주장 원문에서 기관명 후보를 찾는다. */
export function extractClaimAgencyNames(claim: string, backendNames: readonly string[] = []): string[] {
  const candidates = [
    ...GOVERNMENT_AGENCIES.flatMap(entry => [entry.source, ...entry.aliases]),
    ...CONTEXTUAL_NAME_PAIRS.flatMap(pair => [...pair]),
  ].sort((a, b) => b.length - a.length);
  const names = [...backendNames];
  const occupied: Array<[number, number]> = [];
  for (const name of candidates) {
    const at = claim.indexOf(name);
    if (at < 0 || occupied.some(([start, end]) => at < end && at + name.length > start)) continue;
    occupied.push([at, at + name.length]);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
