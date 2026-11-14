export const CLAIM_KINDS = ['기관', '사업명', '수치', '기간', '대상'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type ClaimComponents = Record<ClaimKind, string[]>;

export interface EvidenceCoverage { hit: number; total: number }
export interface TextEvidence {
  rank?: number; source?: string; title?: string; url?: string;
  chunk_text?: string; display_text?: string; published_date?: string;
  date_source?: string; date_basis?: string; as_of?: string;
  matched?: Partial<ClaimComponents>; missing?: Partial<ClaimComponents>;
  coverage?: EvidenceCoverage;
}
export interface TextScope { agencies?: number; documents?: number; period?: string; date_range?: string; collection_period?: string; note?: string }
export interface ResearchCandidate { rank?: number | string; candidate_relevant?: boolean; dense_score?: number; p_entail?: number; p_neutral?: number; p_contradiction?: number }
export interface TextResearch {
  candidates?: ResearchCandidate[]; searched_chunks?: number; relevant_chunks?: number;
  unique_documents?: number; displayed_documents?: number; combined_enabled?: boolean;
  combined_tried?: number; dense_min?: number; entail_threshold?: number; contradiction_threshold?: number;
}
export interface TextPredictResponse {
  status?: string; result?: string; error?: string; message?: string;
  evidence?: TextEvidence[]; claim_components?: ClaimComponents;
  scope?: TextScope; research?: TextResearch;
}
export interface NormalizedTextResult {
  status: string; claim: string; comps: ClaimComponents; evidence: TextEvidence[];
  scope?: TextScope; research?: TextResearch; message?: string;
}
export type TextAnalysisState =
  | { status: 'idle'; result: null; error: null }
  | { status: 'loading'; result: null; error: null }
  | { status: 'done'; result: NormalizedTextResult; error: null }
  | { status: 'error'; result: null; error: string };
