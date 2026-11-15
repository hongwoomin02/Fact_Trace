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
              동영상을 업로드하면 RetinaFace를 통해 얼굴을 검출하고, CLIP ViT-L/14 기반의 3개 모델 앙상블을 활용하여 최대 10개 프레임의 합성 여부(REAL / FAKE)를 분석합니다.
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
              방문객 얼굴 사진과 원본 영상을 조합하여 글로벌호스트 RTX 3090 GPU로 딥페이크를 즉석 합성해 봅니다.
            </p>
            <div className="card-footer">
              <span className="btn-link btn-link--demo">시연 스튜디오 가기 →</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
