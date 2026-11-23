import { useState, useRef, useEffect, useCallback } from 'react';
import type { TemplateVideo, JobStatus, GenErrorCode, SynthesisModel } from '../types/gen';
import {
  fetchTemplates,
  createJob,
  getJobStatus,
  deleteJob,
  downloadResultBlob,
  getErrorMessageByCode,
  DETECT_URL,
  IS_MOCK_ENV,
} from '../lib/genApi';

type Step = 1 | 2 | 3;

export default function DemoGeneratePage() {
  // noindex 메타 태그 삽입
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    let created = false;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex, nofollow';
      document.head.appendChild(meta);
      created = true;
    } else {
      meta.content = 'noindex, nofollow';
    }

    return () => {
      if (created && meta && meta.parentNode) {
        meta.parentNode.removeChild(meta);
      }
    };
  }, []);

  // ───────────────────────────────────────────
  // 전체 상태 관리
  // ───────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<Step>(1);

  // 1단계: 사진 관련 상태
  const [hasAgreed, setHasAgreed] = useState(false);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  // 2단계: 템플릿 선택 상태
  const [templates, setTemplates] = useState<TemplateVideo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<SynthesisModel>('facefusion');
  const modelName = selectedModel === 'facefusion' ? 'FaceFusion' : 'FSGAN';
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // 3단계: 합성 및 결과 상태
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>('queued');
  const [progress, setProgress] = useState<number>(0);
  const [jobError, setJobError] = useState<{ code: GenErrorCode | string; message: string } | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultVideoBlob, setResultVideoBlob] = useState<Blob | null>(null);

  const pollingTimerRef = useRef<number | null>(null);
  const jobStartTimeRef = useRef<number>(0);
  const synthesisRef = useRef<AbortController | null>(null);
  const [isSimulated, setIsSimulated] = useState(IS_MOCK_ENV);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // URL mockError 파라미터 확인 (?mockError=FACE_NOT_FOUND 등)
  const getMockErrorParam = (): GenErrorCode | null => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('mockError');
    return (err as GenErrorCode) || null;
  };

  // ───────────────────────────────────────────
  // 1단계: 웹캠 카메라 라이프사이클 (안정적인 Ref 기반)
  // ───────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch { /* ignore */ }
      });
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const cameraRequest = cameraRequestRef.current;
    setCameraError(null);

    // 보안 컨텍스트 확인 (HTTPS 또는 localhost)
    if (!window.isSecureContext) {
      setCameraError('카메라는 보안 연결(localhost 또는 HTTPS)에서만 지원됩니다. 주소창이 http://localhost:5173 인지 확인해 주시거나 아래 [사진 파일 선택]을 이용해 주세요.');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('이 브라우저는 웹캠 카메라 접근을 지원하지 않습니다. [사진 파일 선택]을 이용해 주세요.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (cameraRequest !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: unknown) {
      if (cameraRequest !== cameraRequestRef.current) return;
      const e = err as { name?: string; message?: string };
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setCameraError('카메라 사용 권한이 차단되었습니다. 브라우저 주소창 좌측의 설정/자물쇠 아이콘을 눌러 카메라 권한을 [허용]하신 후 아래 [카메라 다시 연결]을 눌러주세요.');
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setCameraError('연결된 카메라(웹캠) 장치를 찾을 수 없습니다. 외장 카메라 연결을 확인하거나 [사진 파일 선택]으로 사진을 등록해 주세요.');
      } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        setCameraError('다른 프로그램(Zoom, Teams 등)이 이미 카메라를 사용 중입니다. 다른 앱을 닫고 다시 시도해 주세요.');
      } else {
        setCameraError(`카메라를 시작할 수 없습니다 (${e.name || '알 수 없는 오류'}). [사진 파일 선택]으로 사진을 등록해 주세요.`);
      }
    }
  }, [stopCamera]);

  // Step 1 진입 시 카메라 실행, 이탈 시 카메라 끄기
  useEffect(() => {
    if (currentStep === 1 && !photoBlob) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentStep, photoBlob, startCamera, stopCamera]);

  // ObjectURL 메모리 정리
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);
  useEffect(() => () => {
    if (resultVideoUrl?.startsWith('blob:')) URL.revokeObjectURL(resultVideoUrl);
  }, [resultVideoUrl]);

  // 사진 촬영 (3초 카운트다운)
  const handleCaptureWithCountdown = () => {
    if (!hasAgreed || countdown !== null) return;
    setCountdown(3);

    let current = 3;
    timerRef.current = window.setInterval(() => {
      current -= 1;
      if (current > 0) {
        setCountdown(current);
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
        setCountdown(null);
        takePhotoNow();
      }
    }, 1000);
  };

  // 캔버스 캡처 (비반전 정상 방향으로 저장)
  const takePhotoNow = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setCameraError('카메라 영상이 준비된 뒤 다시 촬영해 주세요.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 중요: 미리보기는 CSS로 좌우반전했지만, 저장하는 원본은 반전 없이 정상 방향으로 렌더링
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopCamera();
        setPhotoBlob(blob);
        const url = URL.createObjectURL(blob);
        setPhotoPreviewUrl(url);
      },
      'image/jpeg',
      0.95
    );
  };

  // 파일 선택 폴백 (최대 10MB)
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일(JPG, PNG, WEBP 등)만 등록할 수 있습니다.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('사진 크기는 10MB 이하여야 합니다.');
      return;
    }

    stopCamera();
    setPhotoBlob(file);
    const url = URL.createObjectURL(file);
    setPhotoPreviewUrl(url);
  };

  // 사진 다시 찍기
  const handleRetakePhoto = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoBlob(null);
    setPhotoPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 1단계 완료 -> 2단계로 진행
  const handleProceedToStep2 = () => {
    if (!photoBlob || !hasAgreed) return;
    setCurrentStep(2);
  };

  // ───────────────────────────────────────────
  // 2단계: 템플릿 목록 로드 및 선택
  // ───────────────────────────────────────────
  useEffect(() => {
    if (currentStep === 2 && templates.length === 0 && !templateError) {
      setLoadingTemplates(true);
      fetchTemplates()
        .then((tpls) => {
          setTemplates(tpls);
          if (tpls.length > 0 && !selectedTemplateId) {
            setSelectedTemplateId(tpls[0].id);
          }
        })
        .catch(() => {
          setTemplateError('원본 영상 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
        })
        .finally(() => setLoadingTemplates(false));
    }
  }, [currentStep, templates.length, selectedTemplateId, templateError]);

  // 2단계 완료 -> 3단계 합성 시작
  const handleProceedToStep3 = () => {
    if (!selectedTemplateId) {
      alert('합성할 원본 영상을 선택해 주세요.');
      return;
    }
    setCurrentStep(3);
    startSynthesis();
  };

  // ───────────────────────────────────────────
  // 3단계: 합성 작업 시작 및 폴링
  // ───────────────────────────────────────────
  const startSynthesis = async () => {
    if (!photoBlob || !selectedTemplateId || !hasAgreed) return;
    synthesisRef.current?.abort();
    if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    const controller = new AbortController();
    synthesisRef.current = controller;

    setJobError(null);
    setJobStatus('queued');
    setProgress(0);
    setResultVideoUrl(null);
    setResultVideoBlob(null);
    jobStartTimeRef.current = Date.now();

    try {
      if (jobId) await deleteJob(jobId);
      const mockOverride = getMockErrorParam();
      const res = await createJob(photoBlob, selectedTemplateId, mockOverride, controller.signal, selectedModel);
      if (controller.signal.aborted) return;
      setJobId(res.job_id);

      // 2초 간격 상태 폴링 시작
      pollStatus(res.job_id, controller.signal);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const e = err as { code?: string; message?: string };
      const code = (e.code as GenErrorCode) || 'INTERNAL';
      setJobStatus('error');
      setJobError({ code, message: e.message || getErrorMessageByCode(code) });
    }
  };

  const pollStatus = (id: string, signal: AbortSignal) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

    const poll = async () => {
      if (signal.aborted) return;
      // 11분(660초) 초과 검사
      const elapsedSec = (Date.now() - jobStartTimeRef.current) / 1000;
      if (elapsedSec > 660) {
        if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
        setJobStatus('error');
        setJobError({ code: 'TIMEOUT', message: getErrorMessageByCode('TIMEOUT') });
        return;
      }

      try {
        const res = await getJobStatus(id, signal);
        if (signal.aborted) return;
        setIsSimulated(IS_MOCK_ENV || res.simulated === true);
        setJobStatus(res.status);
        if (typeof res.progress === 'number') {
          setProgress(res.progress);
        }

        if (res.status === 'done' && res.result_url) {
          if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
          setProgress(100);

          // 비디오 Blob 다운로드 및 로드
          try {
            const blob = await downloadResultBlob(res.result_url, signal);
            if (signal.aborted) return;
            setResultVideoBlob(blob);
            const objectUrl = URL.createObjectURL(blob);
            setResultVideoUrl(objectUrl);
          } catch {
            if (signal.aborted) return;
            setJobStatus('error');
            setJobError({ code: 'INTERNAL', message: '결과 영상 다운로드에 실패했습니다. 다시 시도해 주세요.' });
          }
          return;
        } else if (res.status === 'error') {
          if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
          const code = (res.error_code as GenErrorCode) || 'INTERNAL';
          setJobError({ code, message: res.message || getErrorMessageByCode(code) });
          return;
        } else if (res.status === 'done') {
          setJobStatus('error');
          setJobError({ code: 'INTERNAL', message: '서버 응답에 결과 영상 주소가 없습니다.' });
          return;
        }
      } catch {
        // 일시적 네트워크 에러는 다음 폴링 시도
      }
      if (!signal.aborted) pollingTimerRef.current = window.setTimeout(poll, 2000);
    };
    pollingTimerRef.current = window.setTimeout(poll, 2000);
  };

  useEffect(() => {
    return () => {
      synthesisRef.current?.abort();
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  // MP4 파일 다운로드 (demo_synthetic_YYYYMMDD_HHmm.mp4)
  const handleDownload = () => {
    const downloadUrl = resultVideoBlob
      ? URL.createObjectURL(resultVideoBlob)
      : resultVideoUrl;
    if (!downloadUrl) return;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const YYYY = now.getFullYear();
    const MM = pad(now.getMonth() + 1);
    const DD = pad(now.getDate());
    const HH = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const filename = `demo_synthetic_${YYYY}${MM}${DD}_${HH}${mm}.mp4`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (resultVideoBlob) {
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
  };

  // 탐지 플랫폼 새 탭 열기
  const handleOpenDetectPlatform = () => {
    window.open(DETECT_URL, '_blank', 'noopener,noreferrer');
  };

  // [처음부터 다시] 버튼: 모든 상태 초기화 & DELETE /jobs/{id}
  const handleResetAll = async () => {
    synthesisRef.current?.abort();
    if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    if (jobId) {
      try {
        await deleteJob(jobId);
      } catch {
        setJobStatus('error');
        setJobError({ code: 'INTERNAL', message: '서버 파일 삭제를 확인하지 못했습니다. [처음부터 다시]를 눌러 삭제를 재시도해 주세요.' });
        return;
      }
    }
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    if (resultVideoUrl && !resultVideoUrl.startsWith('/')) URL.revokeObjectURL(resultVideoUrl);

    setPhotoBlob(null);
    setPhotoPreviewUrl(null);
    setJobId(null);
    setJobStatus('queued');
    setProgress(0);
    setJobError(null);
    setResultVideoUrl(null);
    setResultVideoBlob(null);
    setCurrentStep(1);
    setHasAgreed(false);
    setSelectedModel('facefusion');
    setTemplateError(null);
  };

  return (
    <div className="page-container demo-generate-container">
      {isSimulated && <p role="status">모의 실행: 결과는 준비된 샘플 영상이며, 방문객 사진으로 실제 얼굴 합성을 수행한 결과가 아닙니다.</p>}
      {templateError && <div role="alert">{templateError} <button onClick={() => setTemplateError(null)}>목록 다시 불러오기</button></div>}
      {/* 상단 시연 전용 배너 */}
      <div className="demo-header-banner">
        <span className="demo-pill-badge">발표 시연 체험용</span>
        <span className="demo-header-desc">방문객 웹캠 얼굴 사진과 원본 영상을 합성하는 체험 페이지입니다. (탐지 플랫폼과 분리 운영)</span>
      </div>

      <div className="page-header">
        <h1 className="page-title">🎭 딥페이크 영상 생성 스튜디오</h1>
        <p className="page-description">
          방문객 본인 얼굴을 선택한 원본 영상에 합성하여 딥페이크 MP4를 생성하고, 탐지 플랫폼(Fact-Trace AI)에서 검증해 봅니다.
        </p>
      </div>

      {/* 3단계 Stepper 헤더 */}
      <div className="demo-stepper-bar">
        <div className={`stepper-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'completed' : ''}`}>
          <span className="stepper-num">1</span>
          <span className="stepper-title">얼굴 사진 촬영</span>
        </div>
        <div className="stepper-divider">→</div>
        <div className={`stepper-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'completed' : ''}`}>
          <span className="stepper-num">2</span>
          <span className="stepper-title">원본 영상 선택</span>
        </div>
        <div className="stepper-divider">→</div>
        <div className={`stepper-item ${currentStep === 3 ? 'active' : ''}`}>
          <span className="stepper-num">3</span>
          <span className="stepper-title">합성 및 결과</span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          1단계: 사진 촬영 (웹캠 / 파일 폴백)
      ───────────────────────────────────────────────────────────── */}
      {currentStep === 1 && (
        <section className="demo-card demo-step-card">
          <div className="demo-card-title-row">
            <span className="badge badge--demo">1단계</span>
            <h2>방문객 얼굴 사진 촬영</h2>
          </div>

          {/* 상시 안내 문구 */}
          <div className="camera-guidelines">
            <span className="guideline-icon">ℹ️</span>
            <p>
              <strong>촬영 안내:</strong> 정면을 바라보세요 · 안경, 모자, 마스크를 벗어주세요 · 필터는 끄고, 팔 길이 정도 거리에서 찍어주세요 · 혼자 찍어주세요
            </p>
          </div>

          {/* 카메라 / 사진 뷰포트 */}
          <div className="camera-viewport-wrap">
            {!photoPreviewUrl ? (
              <div className="webcam-box">
                {/* 비디오는 거울처럼 CSS로만 좌우반전 */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => {
                    videoRef.current?.play().catch(() => {});
                  }}
                  className="webcam-video-element"
                />

                {/* 타원형 얼굴 가이드 오버레이 */}
                <div className="face-oval-guide" />

                {/* 3초 카운트다운 표시 */}
                {countdown !== null && (
                  <div className="countdown-overlay">
                    <span className="countdown-number">{countdown}</span>
                  </div>
                )}

                {/* 카메라 에러 안내 */}
                {cameraError && (
                  <div className="camera-error-overlay">
                    <p>{cameraError}</p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={startCamera}
                      >
                        🔄 카메라 다시 시도
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        📁 사진 파일 선택하기
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="captured-photo-box">
                <img
                  src={photoPreviewUrl}
                  alt="촬영된 방문객 사진"
                  className="captured-photo-img"
                />
                <span className="photo-ok-badge">✓ 촬영 완료</span>
              </div>
            )}
          </div>

          {/* 필수 개인정보 동의 체크박스 */}
          <div className="privacy-consent-box">
            <label className="privacy-consent-label">
              <input
                type="checkbox"
                checked={hasAgreed}
                onChange={(e) => setHasAgreed(e.target.checked)}
                className="privacy-checkbox"
              />
              <span className="privacy-consent-text">
                <strong>(필수 동의)</strong> 본인 얼굴 및 사용 동의를 받은 원본 영상으로 시연용 합성에 동의합니다. 사진은 처리 후 삭제되며 결과는 삭제 버튼 또는 30분 만료 시 삭제됩니다.
              </span>
            </label>
          </div>

          {/* 1단계 조작 버튼 */}
          <div className="demo-btn-row">
            {!photoPreviewUrl ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-large"
                  disabled={!hasAgreed || countdown !== null}
                  onClick={handleCaptureWithCountdown}
                >
                  📸 3초 타이머 사진 촬영
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!hasAgreed}
                  onClick={() => fileInputRef.current?.click()}
                >
                  📁 사진 파일 선택 (웹캠 대체)
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleRetakePhoto}
                >
                  🔄 다시 찍기
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-large"
                  disabled={!hasAgreed}
                  onClick={handleProceedToStep2}
                >
                  이 사진으로 진행하기 →
                </button>
              </>
            )}

            {/* 숨겨진 파일 인풋 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────
          2단계: 원본 영상 선택 (3~5개 템플릿 카드)
      ───────────────────────────────────────────────────────────── */}
      {currentStep === 2 && (
        <section className="demo-card demo-step-card">
          <div className="demo-card-title-row">
            <span className="badge badge--demo">2단계</span>
            <h2>원본 영상 선택</h2>
          </div>
          <p className="step-desc">
            얼굴을 합성할 베이스 영상을 1개 선택해 주세요.
          </p>

          <fieldset style={{ border: '1px solid var(--border-color, #475569)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <legend>합성 방식 선택</legend>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {(['facefusion', 'fsgan'] as const).map((model) => (
                <label key={model} className="btn btn-secondary" style={{ cursor: 'pointer', outline: selectedModel === model ? '2px solid #818cf8' : undefined }}>
                  <input type="radio" name="synthesis-model" value={model} checked={selectedModel === model} onChange={() => setSelectedModel(model)} />
                  {model === 'facefusion' ? 'FaceFusion' : 'FSGAN'}
                </label>
              ))}
            </div>
            <p style={{ marginTop: 12 }}>선택한 방식으로 촬영한 얼굴과 원본 영상을 합성합니다.</p>
          </fieldset>

          <button className="btn btn-secondary" onClick={() => { setTemplates([]); setSelectedTemplateId(''); setTemplateError(null); }}>목록 새로고침</button>
          {!loadingTemplates && !templateError && templates.length === 0 && <p role="status">등록된 원본 영상이 없습니다. 서버 원본 영상 폴더에 영상을 넣고 목록을 새로고침해 주세요.</p>}
          {loadingTemplates ? (
            <div className="loading-templates-box">템플릿 목록 로드 중...</div>
          ) : (
            <div className="template-card-grid">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className={`template-item-card ${selectedTemplateId === tpl.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                >
                  <div className="template-thumb-wrap">
                    {tpl.preview_url ? <video src={tpl.preview_url} muted playsInline controls preload="metadata" className="template-thumb-img" /> : <img src={tpl.thumbnail_url} alt={tpl.title} className="template-thumb-img" />}
                    {tpl.duration_sec != null && <span className="template-duration-pill">{tpl.duration_sec}초</span>}
                  </div>
                  <div className="template-body">
                    <h3 className="template-title">{tpl.title}</h3>
                    {tpl.description && <p className="template-desc">{tpl.description}</p>}
                  </div>
                  <div className="template-select-indicator">
                    {selectedTemplateId === tpl.id ? '● 선택됨' : '○ 선택'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="demo-btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCurrentStep(1)}
            >
              ← 이전 (사진 변경)
            </button>

            <button
              type="button"
              className="btn btn-primary btn-large"
              disabled={!selectedTemplateId}
              onClick={handleProceedToStep3}
            >
              ✨ {modelName} 합성 시작 →
            </button>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3단계: 합성과 결과
      ───────────────────────────────────────────────────────────── */}
      {currentStep === 3 && (
        <section className="demo-card demo-step-card">
          <div className="demo-card-title-row">
            <span className="badge badge--demo">3단계</span>
            <h2>{modelName} 합성 진행 및 결과</h2>
          </div>

          {/* 상태 1: 진행 중 (queued 또는 processing) */}
          {(jobStatus === 'queued' || jobStatus === 'processing') && (
            <div className="synthesis-progress-box">
              <div className="spinner-large" />
              <h3>
                {jobStatus === 'queued'
                  ? '합성 대기열 대기 중...'
                  : `${modelName} 합성 중...`}
              </h3>
              <p className="progress-sub-text">
                서버가 GPU({modelName})로 프레임별 얼굴 스왑 및 인코딩을 수행하고 있습니다.
              </p>

              {/* 진행률 바 */}
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="progress-percent-label">{progress}%</span>
            </div>
          )}

          {/* 상태 2: 에러 발생 */}
          {jobStatus === 'error' && (
            <div className="error-alert-box">
              <div className="error-alert-header">
                <strong>❌ 합성 중 문제가 발생했습니다</strong>
              </div>
              <p className="error-alert-message">
                {jobError?.message || '알 수 없는 오류가 발생했습니다.'}
              </p>
              <div className="demo-btn-row" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCurrentStep(1)}
                >
                  📸 사진 다시 찍기
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={startSynthesis}
                >
                  🔄 다시 시도
                </button>
              </div>
            </div>
          )}

          {/* 상태 3: 완료 (done) */}
          {jobStatus === 'done' && (
            <div className="synthesis-result-box">
              {/* 고정 배지: 시연용 합성 영상 */}
              <div className="synthetic-watermark-badge">
                ⚠️ 본 영상은 시연용으로 생성된 합성(Deepfake) 영상입니다.
              </div>

              {/* 비디오 미리보기 */}
              <div className="result-video-container">
                <video
                  src={resultVideoUrl || undefined}
                  controls
                  playsInline
                  autoPlay
                  loop
                  className="result-video-element"
                  onError={() => {
                    setJobStatus('error');
                    setJobError({ code: 'INTERNAL', message: '결과 영상을 재생할 수 없습니다. 서버의 원본·샘플 영상이 정상적인 MP4 파일인지 확인해 주세요.' });
                  }}
                />
              </div>

              {/* 액션 버튼 그룹 */}
              <div className="result-action-buttons">
                <button
                  type="button"
                  className="btn btn-secondary btn-large"
                  onClick={handleDownload}
                >
                  💾 MP4 다운로드
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-large btn-detect-link"
                  onClick={handleOpenDetectPlatform}
                >
                  🔍 탐지 플랫폼(Fact-Trace AI)에서 확인하기 ↗
                </button>

                <button
                  type="button"
                  className="btn btn-danger-outline"
                  onClick={handleResetAll}
                >
                  🗑️ 처음부터 다시 (사진·결과 삭제)
                </button>
              </div>

              <div className="result-safe-notice">
                <small>
                  ※ [처음부터 다시]는 사진·결과 삭제를 요청합니다. 서버 삭제에 실패하면 안내 메시지가 표시되므로 다시 시도해 주세요.
                </small>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
