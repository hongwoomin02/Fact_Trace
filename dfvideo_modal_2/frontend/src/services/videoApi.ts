import type { VideoPredictResponse } from '../types/video';

const API_TIMEOUT_MS = 180_000;

export interface PredictResult {
  result: VideoPredictResponse;
  elapsedMs: number;
}

export async function predictVideo(
  file: File,
  signal?: AbortSignal
): Promise<PredictResult> {
  const baseUrl = (import.meta.env.VITE_VIDEO_API_BASE_URL || '/api/video').replace(/\/$/, '');
  const url = `${baseUrl}/predict?return_frames=true`;

  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  const t0 = performance.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const elapsedMs = Math.round(performance.now() - t0);
    clearTimeout(timeoutId);

    if (!response.ok) {
      let message = `서버 오류 (HTTP ${response.status})`;
      let detailText = '';
      try {
        const body = await response.json();
        if (body.detail) {
          detailText = String(body.detail);
          // 서버 내부 임시 파일 경로(/tmp/...) 사용자 화면 노출 방지
          const sanitized = detailText.replace(/\/tmp\/[^\s'"]+/g, '(영상 파일)');
          message = sanitized;
        }
      } catch {
        // JSON 파싱 실패 시 기본 메시지 유지
      }

      if (response.status === 400) {
        if (detailText.includes('영상을 열 수 없음') || detailText.includes('프레임 수를 읽을 수 없음')) {
          throw new Error('영상 파일을 열거나 디코딩할 수 없습니다. 손상된 영상이거나 지원되지 않는 비디오 코덱일 수 있습니다. 다른 MP4/MOV 파일로 다시 시도해 주세요.');
        }
        throw new Error(`영상 파일을 처리할 수 없습니다. 형식이나 파일 손상 여부를 확인해 주세요. (${message})`);
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new Error(`탐지 서버(Modal)가 응답하지 않거나 기동(Cold Start) 중입니다 (HTTP ${response.status}). 잠시 후 [다시 시도]를 눌러주세요.`);
      }
      throw new Error(message);
    }

    const result: VideoPredictResponse = await response.json();
    return { result, elapsedMs };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (signal?.aborted) {
        throw new Error('사용자에 의해 분석 요청이 취소되었습니다.');
      }
      throw new Error('분석 요청 시간이 초과되었습니다 (180초). 영상 길이가 길거나 GPU 서버 초기 기동(Cold Start) 중일 수 있습니다. [다시 시도]를 눌러주세요.');
    }
    if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
      throw new Error('탐지 서버에 연결할 수 없습니다. 네트워크 연결 상태 또는 Modal 백엔드 프록시 설정을 확인해 주세요.');
    }
    throw err;
  }
}

