export type VideoVerdict = 'REAL' | 'FAKE' | 'UNKNOWN';

export interface VideoFrame {
  frame_index: number;
  time_sec: number | null;
  status: string;           // 'ok', 'no_face', 'read_fail'
  face_detected: boolean;
  bbox: number[] | null;
  margin: number | null;
  verdict: 'REAL' | 'FAKE' | null;
  crop_jpeg_base64?: string;
}

export interface TimingMs {
  decode_detect_crop: number;
  model: number;
  total: number;
}

export interface VideoPredictResponse {
  api_version: string;
  model: string;
  n_seeds: number;
  device: string;
  video: string;
  n_frames_total: number;
  fps: number;
  n_frames_sampled: number;
  n_frames_used: number;
  threshold: number;
  verdict: VideoVerdict;
  video_margin: number | null;
  seed_margins: number[] | null;
  fake_score_display?: number | null;
  frames: VideoFrame[];
  warnings: string[];
  timing_ms: TimingMs;
}

export interface AnalysisState {
  status: 'idle' | 'uploading' | 'done' | 'error';
  result: VideoPredictResponse | null;
  error: string | null;
  elapsedMs: number | null;   // 브라우저 측정 HTTP 왕복 시간
  lastFile: File | null;      // 재시도를 위한 마지막 분석 파일
}

/**
 * 조작 의심 점수 (0~100 스케일) 산출 함수
 * 
 * 1. UNKNOWN(얼굴 미검출 등) 판정인 경우 점수를 표시하지 않고 null 반환
 * 2. 백엔드 응답에 유효한 0~1 fake_score_display가 존재하면 100을 곱해 사용
 * 3. fake_score_display가 없으면 검증된 video_margin으로 시그모이드 수식 계산:
 *    vm = logit_real - logit_fake 이므로
 *    fake_score = 1 / (1 + exp(vm)) * 100
 * 
 * ※ 주의: 본 점수는 모델 내부 로짓 마진의 비선형 스케일링 값(미보정 점수)이며,
 *   실제 확률(Probability)로 단정하여 표현하지 않습니다.
 */
export function getManipulationScore(response: VideoPredictResponse): number | null {
  if (response.verdict === 'UNKNOWN') {
    return null;
  }

  // 1. fake_score_display가 있으면 우선 사용
  if (typeof response.fake_score_display === 'number' && Number.isFinite(response.fake_score_display)
      && response.fake_score_display >= 0 && response.fake_score_display <= 1) {
    const raw = response.fake_score_display;
    return raw * 100;
  }

  // 2. video_margin 기반 검증된 시그모이드 수식 계산
  if (typeof response.video_margin === 'number' && Number.isFinite(response.video_margin)) {
    const score = 1 / (1 + Math.exp(response.video_margin));
    return score * 100;
  }

  return null;
}

/** Validate external JSON before it reaches components that format numbers and arrays. */
export function parseVideoResponse(value: unknown): VideoPredictResponse {
  const object = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const nullableNumber = (v: unknown) => v === null || finite(v);
  const count = (v: unknown) => finite(v) && Number.isInteger(v) && v >= 0;
  const frameValid = (f: unknown) => object(f)
    && count(f.frame_index) && nullableNumber(f.time_sec) && nullableNumber(f.margin)
    && typeof f.status === 'string' && typeof f.face_detected === 'boolean'
    && [null, 'REAL', 'FAKE'].includes(f.verdict as string | null)
    && (f.crop_jpeg_base64 === undefined || typeof f.crop_jpeg_base64 === 'string');
  if (!object(value)
    || !['REAL', 'FAKE', 'UNKNOWN'].includes(value.verdict as string)
    || !nullableNumber(value.video_margin)
    || !['api_version', 'model', 'device', 'video'].every(k => typeof value[k] === 'string')
    || !['n_seeds', 'n_frames_total', 'n_frames_sampled', 'n_frames_used'].every(k => count(value[k]))
    || !Array.isArray(value.frames) || !value.frames.every(frameValid)
    || !Array.isArray(value.warnings) || !value.warnings.every(w => typeof w === 'string')
    || !object(value.timing_ms) || !finite(value.timing_ms.total) || value.timing_ms.total < 0) {
    throw new Error('분석 서버의 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.');
  }
  return value as unknown as VideoPredictResponse;
}
