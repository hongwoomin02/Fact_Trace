import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import VideoUploader from '../components/VideoUploader';
import VideoAnalysisResult from '../components/VideoAnalysisResult';
import type { AnalysisState } from '../types/video';
import { predictVideo } from '../services/videoApi';

const INITIAL_STATE: AnalysisState = {
  status: 'idle',
  result: null,
  error: null,
  elapsedMs: null,
  lastFile: null,
};

export default function VideoPage() {
  const location = useLocation();
  const autoLoadFile = (location.state as { autoLoadFile?: File })?.autoLoadFile || null;
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const requestRef = useRef<AbortController | null>(null);
  const [uploaderKey, setUploaderKey] = useState(0);
  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const handleReset = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const handleAnalyze = useCallback(async (file: File) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setState({
      status: 'uploading',
      result: null,
      error: null,
      elapsedMs: null,
      lastFile: file,
    });

    try {
      const { result, elapsedMs } = await predictVideo(file, request.signal);
      if (requestRef.current !== request) return;
      setState({
        status: 'done',
        result,
        error: null,
        elapsedMs,
        lastFile: file,
      });
    } catch (err) {
      if (requestRef.current !== request) return;
      const errorMessage =
        err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setState((prev) => ({
        status: 'error',
        result: null,
        error: errorMessage,
        elapsedMs: null,
        lastFile: prev.lastFile,
      }));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (!state.lastFile) return;
    handleAnalyze(state.lastFile);
  }, [state.lastFile, handleAnalyze]);

  return (
    <div className="page-container video-page">
      <div className="page-header">
        <h1 className="page-title">🎬 영상 딥페이크 탐지</h1>
        <p className="page-description">
          영상을 업로드하면 AI가 10개 프레임에서 얼굴 영역을 추출하고,
          v6 앙상블 신경망을 통해 딥페이크 여부(REAL / FAKE)를 정밀 분석합니다.
        </p>
      </div>

      {/* 영상 업로드 컴포넌트 */}
      <VideoUploader
        key={uploaderKey}
        onAnalyze={handleAnalyze}
        onCancel={() => requestRef.current?.abort()}
        isAnalyzing={state.status === 'uploading'}
        onReset={handleReset}
        initialFile={uploaderKey === 0 ? autoLoadFile : null}
      />

      {/* 오류 메시지 박스 */}
      {state.status === 'error' && state.error && (
        <div className="error-alert-box">
          <div className="error-alert-header">
            <span className="error-icon">❌</span>
            <strong>분석 실패 안내</strong>
          </div>
          <p className="error-alert-message">{state.error}</p>

          {state.lastFile && (
            <div className="error-retry-action-row">
              <button
                className="btn btn-primary btn-retry"
                onClick={handleRetry}
              >
                🔄 동일 파일로 다시 시도
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { handleReset(); setUploaderKey(k => k + 1); }}
              >
                📁 다른 파일 선택
              </button>
            </div>
          )}

          <div className="error-alert-help">
            <p>※ 권장 해결 방법:</p>
            <ul>
              <li>파일 확장자가 MP4, MOV, WEBM 등 일반 동영상 포맷인지 확인해 주세요.</li>
              <li>0바이트 파일이나 손상된 영상이 아닌지 확인해 주세요.</li>
              <li>GPU 서버 Cold Start(초기 기동) 상태인 경우 처음 1회는 30초~1분 정도 소요될 수 있으므로 [다시 시도]를 눌러주세요.</li>
            </ul>
          </div>
        </div>
      )}

      {/* 분석 결과 컴포넌트 */}
      {state.status === 'done' && state.result && state.elapsedMs !== null && (
        <VideoAnalysisResult result={state.result} elapsedMs={state.elapsedMs} />
      )}
    </div>
  );
}
