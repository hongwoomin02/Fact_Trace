import { useCallback, useEffect, useRef, useState } from 'react';
import TextInput from '../components/TextInput';
import TextAnalysisResult from '../components/TextAnalysisResult';
import { analyzeText } from '../services/textApi';
import type { TextAnalysisState } from '../types/text';

const INITIAL_STATE: TextAnalysisState = { status: 'idle', result: null, error: null };

export default function TextPage() {
  const [state, setState] = useState<TextAnalysisState>(INITIAL_STATE);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(INITIAL_STATE);
  }, []);

  const run = useCallback(async (text: string) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ status: 'loading', result: null, error: null });

    try {
      const result = await analyzeText(text, request.signal);
      if (controller.current !== request) return;
      setState({ status: 'done', result, error: null });
    } catch (error) {
      if (controller.current !== request || request.signal.aborted) return;
      setState({
        status: 'error',
        result: null,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      });
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, []);

  return (
    <div className="page-container text-page">
      <div className="page-header">
        <h1 className="page-title">텍스트 공식자료 대조</h1>
        <p className="page-description">
          기사 문장과 관련 공식자료를 나란히 놓고 직접 비교합니다.
        </p>
      </div>
      <TextInput onAnalyze={run} isAnalyzing={state.status === 'loading'} onReset={reset} />
      {state.status === 'error' && (
        <div className="error-alert-box">
          <div className="error-alert-header"><strong>검색 실패 안내</strong></div>
          <p className="error-alert-message">{state.error}</p>
        </div>
      )}
      {state.status === 'idle' && (
        <div className="text-state text-idle">
          <span className="text-status">—</span>
          <div>
            <strong>검색 결과 · 자동 진위 판정 아님</strong>
            <p>문장을 입력하면 대조 가능한 관련 공식자료를 검색합니다.</p>
          </div>
        </div>
      )}
      {state.status === 'done' && <TextAnalysisResult result={state.result} />}
    </div>
  );
}
