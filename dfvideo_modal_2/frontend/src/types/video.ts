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
  fake_score_display: number | null;
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
 * 2. 백엔드 응답에 fake_score_display가 존재하면 이를 우선 사용 (0~1 범위면 * 100)
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
  if (typeof response.fake_score_display === 'number' && !isNaN(response.fake_score_display)) {
    const raw = response.fake_score_display;
    return raw <= 1.0 ? raw * 100 : raw;
  }

  // 2. video_margin 기반 검증된 시그모이드 수식 계산
  if (typeof response.video_margin === 'number' && !isNaN(response.video_margin)) {
    const score = 1 / (1 + Math.exp(response.video_margin));
    return score * 100;
  }

  return null;
}

