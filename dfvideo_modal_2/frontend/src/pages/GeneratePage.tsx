import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PresetVideo, GenerateState } from '../types/generate';
import { synthesizeVideo } from '../services/generateApi';

const PRESET_VIDEOS: PresetVideo[] = [
  {
    id: 'preset-news',
    title: '뉴스 앵커 스피치',
    duration: '3.2초',
    description: '정면 얼굴이 또렷하고 조명이 안정적인 뉴스 보도 장면',
    tag: '권장 · 고품질',
    thumbnailColor: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
  },
  {
    id: 'preset-interview',
    title: '인물 단독 인터뷰',
    duration: '4.0초',
    description: '자연스러운 눈 깜빡임과 표정 변화가 있는 근접 샷',
    tag: '표정 변화',
    thumbnailColor: 'linear-gradient(135deg, #065f46, #10b981)',
  },
  {
    id: 'preset-vlog',
    title: '야외 브이로그 일상',
    duration: '4.8초',
    description: '빛 반사와 카메라 미세 흔들림이 포함된 현실적인 영상',
    tag: '실전 환경',
    thumbnailColor: 'linear-gradient(135deg, #831843, #ec4899)',
  },
  {
    id: 'preset-talk',
    title: '강연 발표 모션',
    duration: '3.5초',
    description: '고개 움직임과 입모양이 역동적인 발표 클립',
    tag: '모션 역동성',
    thumbnailColor: 'linear-gradient(135deg, #78350f, #f59e0b)',
  },
];

const INITIAL_STATE: GenerateState = {
  step: 'idle',
  progress: 0,
  statusMessage: '',
  resultVideoUrl: null,
  resultVideoBlob: null,
  error: null,
};

export default function GeneratePage() {
  const navigate = useNavigate();

  // 1. 얼굴 사진 상태
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [imageDragOver, setImageDragOver] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 2. 원본 영상 선택 상태
  const [selectedPresetId, setSelectedPresetId] = useState<string>('preset-news');
  const [customVideoFile, setCustomVideoFile] = useState<File | null>(null);
  const [useCustomVideo, setUseCustomVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // 3. 합성 프로세스 상태
  const [state, setState] = useState<GenerateState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 사진 선택 핸들러
  const handleSelectImage = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('얼굴 사진 파일(JPG, PNG, WEBP 등)만 업로드할 수 있습니다.');
      return;
    }
    setSourceImage(file);
    setSourcePreviewUrl(URL.createObjectURL(file));
    setState((prev) => ({ ...prev, error: null, resultVideoUrl: null }));
  }, []);

  // 커스텀 영상 선택 핸들러
  const handleSelectCustomVideo = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('동영상 파일(MP4, MOV 등)만 선택할 수 있습니다.');
      return;
    }
    setCustomVideoFile(file);
    setUseCustomVideo(true);
  }, []);

  // 합성 시작
  const handleStartGeneration = async () => {
    if (!sourceImage) {
      alert('방문객 얼굴 사진을 먼저 업로드해 주세요.');
      return;
    }

    const ac = new AbortController();
    abortControllerRef.current = ac;

    setState({
      step: 'detecting_face',
      progress: 5,
      statusMessage: '작업 초기화 중...',
      resultVideoUrl: null,
      resultVideoBlob: null,
      error: null,
    });

    try {
      const targetParam = useCustomVideo && customVideoFile ? customVideoFile : selectedPresetId;

      const { videoBlob, videoUrl } = await synthesizeVideo({
        sourceImageFile: sourceImage,
        targetVideoBlobOrPresetId: targetParam,
        onProgress: (progress, message) => {
          setState((prev) => ({
            ...prev,
            progress,
            statusMessage: message,
            step: progress < 40 ? 'detecting_face' : progress < 85 ? 'swapping_frames' : 'encoding',
          }));
        },
        signal: ac.signal,
      });

      setState({
        step: 'done',
        progress: 100,
        statusMessage: '딥페이크 영상 합성이 완료되었습니다!',
        resultVideoUrl: videoUrl,
        resultVideoBlob: videoBlob,
        error: null,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        setState(INITIAL_STATE);
        return;
      }
      setState({
        step: 'error',
        progress: 0,
        statusMessage: '',
        resultVideoUrl: null,
        resultVideoBlob: null,
        error: err instanceof Error ? err.message : '영상 합성 중 오류가 발생했습니다.',
      });
    }
  };

  // 합성 취소
  const handleCancelGeneration = () => {
    abortControllerRef.current?.abort();
  };

  // MP4 다운로드
  const handleDownload = () => {
    if (!state.resultVideoUrl) return;
    const a = document.createElement('a');
    a.href = state.resultVideoUrl;
    a.download = `facefusion_synth_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 탐지 플랫폼으로 바로 이동하여 검증
  const handleGoToDetection = () => {
    if (!state.resultVideoBlob) return;
    // 생성된 비디오 Blob을 File 객체로 변환하여 탐지 페이지에 전달
    const synthFile = new File([state.resultVideoBlob], 'facefusion_synthesized_sample.mp4', {
      type: 'video/mp4',
    });
    navigate('/video', { state: { autoLoadFile: synthFile } });
  };

  const isGenerating = state.step !== 'idle' && state.step !== 'done' && state.step !== 'error';

  return (
    <div className="page-container generate-page">
      {/* 상단 안내 배너 */}
      <div className="demo-notice-badge">
        <span className="demo-tag">발표 시연 체험용</span>
        <span>이 페이지는 방문객 시연을 위한 독립 생성 스튜디오이며, 탐지 플랫폼(Fact-Trace AI)과 분리되어 운영됩니다.</span>
      </div>

      <div className="page-header">
        <h1 className="page-title">🎭 FaceFusion 딥페이크 영상 생성 스튜디오</h1>
        <p className="page-description">
          방문객 얼굴 사진과 3~5초 원본 영상을 조합하여 글로벌호스트 RTX 4090 GPU로 딥페이크 합성 영상을 생성합니다.
        </p>
      </div>

      {/* 시연 단계 워크플로우 인포그래픽 */}
      <div className="workflow-steps-bar">
        <div className={`wf-step ${sourceImage ? 'wf-step--completed' : 'wf-step--active'}`}>
          <span className="wf-step-num">1</span>
          <span className="wf-step-label">얼굴 사진 촬영/업로드</span>
        </div>
        <div className="wf-step-arrow">→</div>
        <div className={`wf-step ${selectedPresetId || useCustomVideo ? 'wf-step--completed' : ''}`}>
          <span className="wf-step-num">2</span>
          <span className="wf-step-label">3~5초 원본 영상 선택</span>
        </div>
        <div className="wf-step-arrow">→</div>
        <div className={`wf-step ${isGenerating ? 'wf-step--active' : state.step === 'done' ? 'wf-step--completed' : ''}`}>
          <span className="wf-step-num">3</span>
          <span className="wf-step-label">RTX 4090 FaceFusion 합성</span>
        </div>
        <div className="wf-step-arrow">→</div>
        <div className={`wf-step ${state.step === 'done' ? 'wf-step--active' : ''}`}>
          <span className="wf-step-num">4</span>
          <span className="wf-step-label">다운로드 & 탐지 검증</span>
        </div>
      </div>

      {/* 메인 2단 구성 그리드 */}
      <div className="generate-two-col">
        {/* ====================================================
            왼쪽 열: 1단계 얼굴 사진 + 2단계 원본 영상
        ==================================================== */}
        <div className="generate-input-col">
          {/* 1. 얼굴 사진 업로드 섹션 */}
          <section className="gen-card">
            <div className="gen-card-header">
              <span className="gen-step-badge">1단계</span>
              <h3>방문객 얼굴 사진 등록</h3>
            </div>
            <p className="gen-card-guide">
              현장에서 촬영한 셀카 사진 또는 정면 얼굴 이미지를 등록해 주세요.
            </p>

            <div
              className={`image-dropzone ${imageDragOver ? 'image-dropzone--drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setImageDragOver(true); }}
              onDragLeave={() => setImageDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setImageDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleSelectImage(file);
              }}
              onClick={() => imageInputRef.current?.click()}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleSelectImage(e.target.files?.[0] || null)}
              />

              {sourcePreviewUrl ? (
                <div className="image-preview-box">
                  <img src={sourcePreviewUrl} alt="선택한 얼굴 사진" className="image-preview-thumb" />
                  <div className="image-preview-meta">
                    <strong>{sourceImage?.name}</strong>
                    <span>{(sourceImage ? sourceImage.size / 1024 : 0).toFixed(1)} KB</span>
                    <button
                      type="button"
                      className="btn-text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSourceImage(null);
                        setSourcePreviewUrl(null);
                      }}
                    >
                      사진 변경/제거
                    </button>
                  </div>
                </div>
              ) : (
                <div className="image-drop-empty">
                  <span className="drop-icon">📷</span>
                  <p className="drop-main-text">방문객 얼굴 사진 선택 또는 드래그</p>
                  <p className="drop-sub-text">정면이 선명한 얼굴 사진 권장 (JPG, PNG)</p>
                </div>
              )}
            </div>
          </section>

          {/* 2. 원본 영상 선택 섹션 */}
          <section className="gen-card">
            <div className="gen-card-header">
              <span className="gen-step-badge">2단계</span>
              <h3>원본 대상 영상 선택 (3~5초)</h3>
            </div>
            <p className="gen-card-guide">
              얼굴을 바꿀 3~5초 분량의 베이스 영상을 선택합니다.
            </p>

            <div className="preset-video-grid">
              {PRESET_VIDEOS.map((preset) => (
                <div
                  key={preset.id}
                  className={`preset-card ${!useCustomVideo && selectedPresetId === preset.id ? 'preset-card--selected' : ''}`}
                  onClick={() => {
                    setSelectedPresetId(preset.id);
                    setUseCustomVideo(false);
                  }}
                >
                  <div className="preset-thumb" style={{ background: preset.thumbnailColor }}>
                    <span className="preset-duration">{preset.duration}</span>
                    <span className="preset-tag">{preset.tag}</span>
                  </div>
                  <div className="preset-info">
                    <h4>{preset.title}</h4>
                    <p>{preset.description}</p>
                  </div>
                  <div className="preset-radio">
                    {!useCustomVideo && selectedPresetId === preset.id ? '●' : '○'}
                  </div>
                </div>
              ))}
            </div>

            {/* 사용자 직접 영상 업로드 토글 */}
            <div className="custom-video-opt">
              <div
                className={`custom-video-box ${useCustomVideo ? 'custom-video-box--active' : ''}`}
                onClick={() => videoInputRef.current?.click()}
              >
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleSelectCustomVideo(e.target.files?.[0] || null)}
                />
                <span>📁 {customVideoFile ? customVideoFile.name : '준비한 영상 파일 직접 업로드 (선택)'}</span>
                {customVideoFile && (
                  <span className="custom-video-size">({(customVideoFile.size / (1024 * 1024)).toFixed(1)}MB)</span>
                )}
              </div>
            </div>
          </section>

          {/* 3. 합성 시작 액션 버튼 */}
          <div className="gen-action-area">
            {!isGenerating ? (
              <button
                className="btn btn-primary btn-large btn-generate"
                disabled={!sourceImage}
                onClick={handleStartGeneration}
              >
                ✨ FaceFusion 합성 시작 (RTX 4090 GPU)
              </button>
            ) : (
              <div className="gen-cancel-wrap">
                <button className="btn btn-danger-outline" onClick={handleCancelGeneration}>
                  합성 취소
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ====================================================
            오른쪽 열: 3단계 합성 진행 상태 & 4단계 결과 화면
        ==================================================== */}
        <div className="generate-output-col">
          <section className="gen-card gen-output-card">
            <div className="gen-card-header">
              <span className="gen-step-badge">결과</span>
              <h3>딥페이크 합성 모니터링 & 결과</h3>
            </div>

            {/* 상태 1: 대기 상태 */}
            {state.step === 'idle' && (
              <div className="gen-idle-placeholder">
                <div className="gen-placeholder-icon">🎬</div>
                <h4>합성 대기 중</h4>
                <p>
                  왼쪽에서 <strong>얼굴 사진</strong>과 <strong>원본 영상</strong>을 선택하고
                  <br />
                  <strong>[합성 시작]</strong> 버튼을 누르면 실시간 딥페이크 합성이 진행됩니다.
                </p>
                <div className="spec-badge-box">
                  <span>가속 서버: 글로벌호스트 NVIDIA RTX 4090</span>
                  <span>합성 엔진: FaceFusion Deep Learning Inswapper</span>
                </div>
              </div>
            )}

            {/* 상태 2: 합성 진행 중 */}
            {isGenerating && (
              <div className="gen-progress-panel">
                <div className="gen-spinner" />
                <h4 className="gen-progress-title">딥페이크 영상 합성 연산 중</h4>
                <p className="gen-progress-desc">{state.statusMessage}</p>

                {/* 프로그레스 바 */}
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${state.progress}%` }} />
                </div>
                <span className="progress-percentage">{state.progress}%</span>

                <div className="gpu-specs-notice">
                  <small>⚡ 글로벌호스트 RTX 4090 GPU 클러스터에서 텐서 코어로 프레임을 실시간 연산하고 있습니다.</small>
                </div>
              </div>
            )}

            {/* 상태 3: 에러 발생 */}
            {state.step === 'error' && state.error && (
              <div className="error-alert-box">
                <div className="error-alert-header">
                  <span className="error-icon">❌</span>
                  <strong>합성 실패</strong>
                </div>
                <p className="error-alert-message">{state.error}</p>
                <button className="btn btn-secondary" onClick={() => setState(INITIAL_STATE)}>
                  다시 시도
                </button>
              </div>
            )}

            {/* 상태 4: 합성 완료 결과물 */}
            {state.step === 'done' && state.resultVideoUrl && (
              <div className="gen-result-view">
                <div className="result-success-badge">
                  <span>🎉 딥페이크 합성 완료!</span>
                </div>

                <div className="result-video-player-wrap">
                  <video
                    src={state.resultVideoUrl}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="result-video-player"
                  />
                </div>

                <div className="result-meta-info">
                  <div>
                    <span>생성 엔진:</span> <strong>FaceFusion v2.6+</strong>
                  </div>
                  <div>
                    <span>가속 GPU:</span> <strong>NVIDIA RTX 4090 (24GB)</strong>
                  </div>
                  <div>
                    <span>해상도/포맷:</span> <strong>HD 720p · MP4 H.264</strong>
                  </div>
                </div>

                {/* 시연 핵심 액션 버튼 2종 */}
                <div className="result-actions-grid">
                  <button className="btn btn-secondary btn-download" onClick={handleDownload}>
                    💾 생성된 MP4 다운로드
                  </button>

                  <button className="btn btn-primary btn-verify-detect" onClick={handleGoToDetection}>
                    🔍 Fact-Trace AI 탐지 플랫폼에서 바로 검증하기 →
                  </button>
                </div>

                <p className="result-hint-text">
                  💡 <strong>시연 팁:</strong> [Fact-Trace AI 탐지 플랫폼에서 바로 검증하기]를 누르면
                  방금 생성된 영상이 탐지 페이지로 즉시 로드되어 FAKE 판정 결과를 방문객에게 보여줄 수 있습니다!
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

