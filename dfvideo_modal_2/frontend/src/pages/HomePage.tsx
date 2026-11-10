import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page-container home-page">
      {/* 1. 메인 히어로 섹션 */}
      <section className="hero-section">
        <span className="hero-badge">Fact-Trace AI 통합 팩트체크 플랫폼</span>
        <h1 className="hero-title">
          허위 정보와 딥페이크로부터<br />진실을 투명하게 증명합니다
        </h1>
        <p className="hero-subtitle">
          최첨단 딥러닝 앙상블 탐지 기술(Fact-Trace AI)로 영상 조작 여부와
          공식 문서 기반 텍스트 사실관계를 신속하고 정밀하게 검증합니다.
        </p>
      </section>

      {/* 2. 핵심 서비스 카드 그리드 (3개) */}
      <section className="service-cards-section">
        <h2 className="section-title">플랫폼 서비스 & 시연 체험</h2>
        <div className="cards-grid cards-grid--three">
          {/* 카드 1: 영상 딥페이크 탐지 (메인) */}
          <div
            className="feature-card feature-card--video"
            onClick={() => navigate('/video')}
            role="button"
            tabIndex={0}
          >
            <div className="card-top-row">
              <span className="card-icon">🔍</span>
              <span className="badge badge--active">메인 탐지</span>
            </div>
            <h3 className="card-title">영상 딥페이크 탐지</h3>
            <p className="card-desc">
              동영상을 업로드하면 RetinaFace 얼굴 검출과 CLIP/ConvNeXt 기반 앙상블 신경망을 통해 10개 프레임의 합성 여부(REAL / FAKE)를 정밀 분석합니다.
            </p>
            <div className="card-footer">
              <span className="btn-link">영상 탐지 시작하기 →</span>
            </div>
          </div>

          {/* 카드 2: 텍스트 팩트체크 (메인) */}
          <div
            className="feature-card feature-card--text"
            onClick={() => navigate('/text')}
            role="button"
            tabIndex={0}
          >
            <div className="card-top-row">
              <span className="card-icon">📰</span>
              <span className="badge badge--active">공식문서 대조</span>
            </div>
            <h3 className="card-title">텍스트 팩트체크</h3>
            <p className="card-desc">
              기사나 소셜 미디어 문장을 입력하면 공공기관 공식 보도자료 DB와 대조하여 수치, 기간, 정책 대상의 진위 여부를 교차 검증합니다.
            </p>
            <div className="card-footer">
              <span className="btn-link">텍스트 대조 시작하기 →</span>
            </div>
          </div>

          {/* 카드 3: 딥페이크 생성 체험 (발표 시연용) */}
          <div
            className="feature-card feature-card--generate"
            onClick={() => navigate('/demo/generate')}
            role="button"
            tabIndex={0}
          >
            <div className="card-top-row">
              <span className="card-icon">🎭</span>
              <span className="badge badge--demo">발표 시연 체험</span>
            </div>
            <h3 className="card-title">FaceFusion 영상 생성</h3>
            <p className="card-desc">
              [체험용 독립 스튜디오] 방문객 얼굴 사진과 3~5초 원본 영상을 조합하여 글로벌호스트 RTX 4090 GPU로 딥페이크를 즉석 합성하고 탐지해 봅니다.
            </p>
            <div className="card-footer">
              <span className="btn-link btn-link--demo">시연 스튜디오 가기 →</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 발표 시연 가이드 인포그래픽 섹션 */}
      <section className="demo-flow-section">
        <div className="demo-flow-card">
          <div className="demo-flow-header">
            <span className="demo-flow-pill">캡스톤 발표 시연 흐름</span>
            <h3>방문객 딥페이크 체험 & 즉시 검증 시연 순서</h3>
            <p>생성 서버는 발표 체험용 별도 페이지이며, 합성된 영상을 Fact-Trace AI 탐지 플랫폼으로 바로 연계 검증합니다.</p>
          </div>

          <div className="demo-flow-grid">
            <div className="demo-flow-item">
              <span className="step-circle">1</span>
              <h4>얼굴 사진 촬영</h4>
              <p>방문객 본인 얼굴 사진 촬영 또는 준비된 인물 사진 선택</p>
            </div>
            <div className="flow-chevron">→</div>
            <div className="demo-flow-item">
              <span className="step-circle">2</span>
              <h4>사진 업로드</h4>
              <p>생성 스튜디오 페이지에 방문객 얼굴 사진 업로드</p>
            </div>
            <div className="flow-chevron">→</div>
            <div className="demo-flow-item">
              <span className="step-circle">3</span>
              <h4>3~5초 원본 선택</h4>
              <p>뉴스, 인터뷰 등 미리 준비된 고화질 원본 영상 선택</p>
            </div>
            <div className="flow-chevron">→</div>
            <div className="demo-flow-item">
              <span className="step-circle">4</span>
              <h4>FaceFusion 합성</h4>
              <p>글로벌호스트 RTX 4090 GPU에서 심층 인스왑 합성 실행</p>
            </div>
            <div className="flow-chevron">→</div>
            <div className="demo-flow-item">
              <span className="step-circle">5</span>
              <h4>MP4 다운로드</h4>
              <p>완성된 고화질 딥페이크 MP4 파일 즉시 다운로드</p>
            </div>
            <div className="flow-chevron">→</div>
            <div className="demo-flow-item highlight">
              <span className="step-circle highlight">6</span>
              <h4>Fact-Trace 검증</h4>
              <p>완성 영상을 탐지 플랫폼에 업로드하여 FAKE 판정 즉시 확인!</p>
            </div>
          </div>

          <div className="demo-flow-action">
            <button className="btn btn-primary" onClick={() => navigate('/demo/generate')}>
              🚀 발표 시연용 영상 생성 스튜디오 열기
            </button>
          </div>
        </div>
      </section>

      {/* 4. 시스템 스펙 안내 섹션 */}
      <section className="info-banner-section">
        <div className="info-banner">
          <h4>💡 백엔드 시스템 인프라 구성</h4>
          <p>
            <strong>탐지 플랫폼 (Fact-Trace AI):</strong> Modal 클라우드 T4 GPU 기반 v6 앙상블 신경망 배포 완료<br />
            <strong>생성 시연 스튜디오:</strong> 글로벌호스트 NVIDIA RTX 4090 서버 기반 FaceFusion 파이프라인 연계
          </p>
        </div>
      </section>
    </div>
  );
}
