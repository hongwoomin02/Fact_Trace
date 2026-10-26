import type { VideoPredictResponse } from '../types/video';
import { getManipulationScore } from '../types/video';
import FrameGallery from './FrameGallery';

interface Props {
  result: VideoPredictResponse;
  elapsedMs: number;
}

export default function VideoAnalysisResult({ result, elapsedMs }: Props) {
  const verdictTextMap: Record<string, { label: string; desc: string; className: string }> = {
    REAL: {
      label: '진본 영상 (REAL)',
      desc: '얼굴 조작(딥페이크) 특징이 감지되지 않았습니다.',
      className: 'verdict-badge--real',
    },
    FAKE: {
      label: '조작 의심 영상 (FAKE)',
      desc: '얼굴 영역에서 딥페이크 합성 패턴이 감지되었습니다.',
      className: 'verdict-badge--fake',
    },
    UNKNOWN: {
      label: '판정 불가 (UNKNOWN)',
      desc: '얼굴이 감지되지 않았거나 프레임 분석 데이터가 부족합니다.',
      className: 'verdict-badge--unknown',
    },
  };

  const verdictInfo = verdictTextMap[result.verdict] || verdictTextMap.UNKNOWN;
  const manipulationScore = getManipulationScore(result);
  const isUnknown = result.verdict === 'UNKNOWN';

  return (
    <div className="analysis-result">
      {/* 1. 상단 종합 판정 배너 */}
      <div className={`verdict-banner ${verdictInfo.className}`}>
        <div className="verdict-banner-header">
          <span className="verdict-status-title">분석 결과</span>
          <h2 className="verdict-main-title">{verdictInfo.label}</h2>
        </div>
        <p className="verdict-sub-desc">{verdictInfo.desc}</p>
      </div>

      {/* 2. 핵심 수치 요약 카드 그리드 */}
      <div className="metrics-grid">
        {/* 카드 1: 조작 의심 점수 (0~100 스케일, UNKNOWN은 점수 미표시) */}
        <div className={`metric-card metric-card--score ${!isUnknown && manipulationScore !== null ? (manipulationScore >= 50 ? 'metric-card--fake' : 'metric-card--real') : ''}`}>
          <span className="metric-label">조작 의심 점수 (0~100)</span>
          <div className="score-display-wrapper">
            <span className="metric-value metric-value--score">
              {!isUnknown && manipulationScore !== null ? `${manipulationScore.toFixed(1)}점` : '판정 불가 (-)'}
            </span>
            {!isUnknown && manipulationScore !== null && (
              <span className={`score-badge ${manipulationScore >= 50 ? 'score-badge--fake' : 'score-badge--real'}`}>
                {manipulationScore >= 50 ? '조작 의심' : '진본 유사'}
              </span>
            )}
          </div>

          {!isUnknown && manipulationScore !== null ? (
            <div className="manipulation-gauge">
              <div className="gauge-track">
                <div
                  className="gauge-indicator"
                  style={{ left: `${Math.min(100, Math.max(0, manipulationScore))}%` }}
                />
              </div>
              <div className="gauge-labels">
                <span>0 (진본)</span>
                <span className="gauge-threshold">기준 50</span>
                <span>100 (조작 의심)</span>
              </div>
            </div>
          ) : (
            <div className="gauge-unknown-notice">
              얼굴 미검출로 점수 산출 불가
            </div>
          )}

          <span className="metric-hint">
            ※ 앙상블 신경망 로짓 마진을 0~100으로 스케일링한 모델 내부 지표(미보정 점수)이며, 통계적 조작 확률을 의미하지 않습니다.
          </span>
        </div>

        {/* 카드 2: 영상 판정 점수 (로짓 마진) */}
        <div className="metric-card">
          <span className="metric-label">영상 판정 점수 (Margin)</span>
          <span className="metric-value">
            {result.video_margin !== null ? result.video_margin.toFixed(4) : '-'}
          </span>
          <span className="metric-hint">
            기준치 0.0 (0 미만: FAKE, 0 이상: REAL)
            <br />
            ※ 단순 확률이 아닌 앙상블 로짓 마진(REAL-FAKE) 값입니다.
          </span>
        </div>

        {/* 카드 3: 얼굴 분석 프레임 */}
        <div className="metric-card">
          <span className="metric-label">얼굴 분석 프레임</span>
          <span className="metric-value">
            {result.n_frames_used} / {result.n_frames_sampled} 프레임
          </span>
          <span className="metric-hint">
            전체 {result.n_frames_total} 프레임 중 10프레임 균등 추출
          </span>
        </div>

        {/* 카드 4: 소요 시간 비교 */}
        <div className="metric-card">
          <span className="metric-label">소요 시간 비교</span>
          <div className="time-comparison">
            <div>
              <span className="time-sub-label">서버 내부 연산:</span>
              <strong className="time-sub-val">{result.timing_ms.total.toLocaleString()} ms</strong>
            </div>
            <div>
              <span className="time-sub-label">브라우저 전체 왕복:</span>
              <strong className="time-sub-val">{elapsedMs.toLocaleString()} ms</strong>
            </div>
          </div>
          <span className="metric-hint">
            브라우저 시간은 영상 업로드 + 네트워크 왕복이 포함되어 서버 시간보다 깁니다.
          </span>
        </div>

        {/* 카드 5: 탐지 모델 정보 */}
        <div className="metric-card">
          <span className="metric-label">탐지 모델 정보</span>
          <span className="metric-value">
            {result.model} ({result.n_seeds}개 시드 앙상블)
          </span>
          <span className="metric-hint">
            디바이스: {result.device} · API v{result.api_version}
          </span>
        </div>
      </div>

      {/* 3. 경고 메시지 섹션 */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="warnings-box">
          <h4 className="warnings-title">⚠️ 안내 및 유의사항</h4>
          <ul className="warnings-list">
            {result.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. 프레임별 상세 검토 갤러리 */}
      <FrameGallery frames={result.frames} />
    </div>
  );
}

