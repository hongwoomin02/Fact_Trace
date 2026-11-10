import { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  onAnalyze: (file: File) => void;
  onCancel: () => void;
  isAnalyzing: boolean;
  onReset: () => void;
  initialFile?: File | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VideoUploader({ onAnalyze, onCancel, isAnalyzing, onReset, initialFile }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 언마운트 시 미리보기 URL 정리
  useEffect(() => {
    const url = selectedFile ? URL.createObjectURL(selectedFile) : null;
    // eslint-disable-next-line react/set-state-in-effect -- Synchronize an external blob URL with its cleanup lifecycle.
    setPreviewUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [selectedFile]);

  const handleSelectFile = useCallback(
    (file: File | null) => {
      if (isAnalyzing) return;
      if (file && !(file.type.startsWith('video/') || /\.(mp4|avi|mov|mkv|webm)$/i.test(file.name))) {
        alert('동영상 파일만 업로드할 수 있습니다.');
        return;
      }
      if (file && file.size === 0) {
        alert('선택한 영상 파일의 크기가 0바이트(빈 파일)입니다. 정상적인 영상 파일을 선택해 주세요.');
        return;
      }
      if (file && file.size > 50 * 1024 * 1024) {
        alert('영상 크기는 50MB 이하여야 합니다.');
        return;
      }
      onReset();

      setSelectedFile(file);
    },
    [isAnalyzing, onReset]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    handleSelectFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isAnalyzing) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isAnalyzing) return;

    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('video/') || /\.(mp4|avi|mov|mkv|webm)$/i.test(file.name))) {
      handleSelectFile(file);
    } else {
      alert('동영상 파일(.mp4, .mov, .webm 등)만 업로드할 수 있습니다.');
    }
  };

  const handleStartAnalysis = () => {
    if (!selectedFile || isAnalyzing) return;
    onAnalyze(selectedFile);
  };

  const handleCancelAnalysis = () => {
    onCancel();
  };

  const handleFullReset = () => {
    if (isAnalyzing) {
      handleCancelAnalysis();
    }
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onReset();
  };

  return (
    <div className="uploader-card">
      {/* 1. 드래그앤드롭 영역 */}
      <div
        className={`drop-area ${isDragOver ? 'drop-area--dragover' : ''} ${
          isAnalyzing ? 'drop-area--disabled' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!isAnalyzing) fileInputRef.current?.click();
        }}
        role="button"
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            if (!isAnalyzing) fileInputRef.current?.click();
          }
        }}
        tabIndex={0}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mp4,.avi,.mov,.mkv,.webm"
          onChange={handleInputChange}
          disabled={isAnalyzing}
          style={{ display: 'none' }}
        />

        <div className="drop-content">
          <span className="drop-icon">📹</span>
          <p className="drop-primary-text">
            {selectedFile
              ? selectedFile.name
              : '동영상 파일을 드래그하여 놓거나 클릭하여 선택하세요'}
          </p>
          <p className="drop-secondary-text">
            {selectedFile
              ? `크기: ${formatFileSize(selectedFile.size)} · 다른 파일을 선택하려면 클릭`
              : 'MP4, MOV, WEBM 등의 영상 파일 지원 (최대 50MB)'}
          </p>
        </div>
      </div>

      {/* 2. 동영상 미리보기 */}
      {previewUrl && (
        <div className="video-preview-wrapper">
          <h4 className="preview-title">선택한 영상 미리보기</h4>
          <video
            src={previewUrl}
            controls
            playsInline
            muted
            className="video-preview-player"
          />
        </div>
      )}

      {/* 3. 액션 버튼 & 진행 상태 표시 */}
      <div className="uploader-controls">
        {!isAnalyzing ? (
          <div className="action-button-group">
            <button
              className="btn btn-primary"
              onClick={handleStartAnalysis}
              disabled={!selectedFile}
            >
              🚀 AI 딥페이크 분석 시작
            </button>
            {selectedFile && (
              <button className="btn btn-secondary" onClick={handleFullReset}>
                초기화
              </button>
            )}
          </div>
        ) : (
          <div className="analyzing-status-panel">
            <div className="spinner-row">
              <div className="spinner" />
              <div className="status-text-col">
                <strong>영상 분석 중입니다...</strong>
                <p>
                  GPU 서버에서 얼굴 영역을 추출하고 AI 모델 앙상블 추론을 수행하고 있습니다.
                  <br />
                  (서버 부팅 또는 긴 영상의 경우 30초~1분 이상 소요될 수 있습니다)
                </p>
              </div>
            </div>
            <div className="cancel-row">
              <button className="btn btn-danger-outline" onClick={handleCancelAnalysis}>
                요청 취소
              </button>
              <span className="cancel-notice">
                ※ 브라우저 요청을 취소해도 서버의 백그라운드 연산은 계속될 수 있습니다.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
