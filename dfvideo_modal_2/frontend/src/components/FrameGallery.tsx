import type { VideoFrame } from '../types/video';

interface Props {
  frames: VideoFrame[];
}

export default function FrameGallery({ frames }: Props) {
  if (!frames || frames.length === 0) {
    return (
      <div className="frame-gallery">
        <h3>검토 프레임</h3>
        <p className="frame-empty-text">검토할 프레임 정보가 없습니다.</p>
      </div>
    );
  }

  const detectedCount = frames.filter((f) => f.face_detected).length;

  return (
    <div className="frame-gallery">
      <div className="frame-gallery-header">
        <h3>검토 프레임 ({detectedCount}/{frames.length} 검출)</h3>
        <p className="frame-gallery-desc">
          영상에서 균등 샘플링된 10개 프레임의 얼굴 영역 검출 결과와 프레임별 판정입니다.
        </p>
      </div>

      <div className="frame-grid">
        {frames.map((frame) => {
          const isFace = frame.face_detected;
          const hasImage = Boolean(frame.crop_jpeg_base64);

          return (
            <div
              key={frame.frame_index}
              className={`frame-card ${!isFace ? 'frame-card--noface' : ''}`}
            >
              <div className="frame-img-wrapper">
                {hasImage ? (
                  <img
                    src={`data:image/jpeg;base64,${frame.crop_jpeg_base64}`}
                    alt={`프레임 #${frame.frame_index} 얼굴 크롭`}
                    className="frame-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="frame-placeholder">
                    {frame.status === 'read_fail'
                      ? '프레임 손상 (읽기 실패)'
                      : isFace
                      ? '얼굴 검출 (이미지 없음)'
                      : '얼굴 미검출'}
                  </div>
                )}
                <span className="frame-badge">#{frame.frame_index}</span>
              </div>

              <div className="frame-info">
                <div className="frame-info-row">
                  <span className="frame-label">시간:</span>
                  <span className="frame-val">
                    {frame.time_sec !== null ? `${frame.time_sec.toFixed(2)}s` : '-'}
                  </span>
                </div>
                <div className="frame-info-row">
                  <span className="frame-label">판정:</span>
                  <span
                    className={`frame-verdict frame-verdict--${frame.verdict || 'none'}`}
                  >
                    {frame.verdict === 'FAKE'
                      ? '조작(FAKE)'
                      : frame.verdict === 'REAL'
                      ? '진본(REAL)'
                      : '판정 불가'}
                  </span>
                </div>
                <div className="frame-info-row">
                  <span className="frame-label">점수:</span>
                  <span className="frame-val">
                    {frame.margin !== null ? frame.margin.toFixed(4) : '-'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

