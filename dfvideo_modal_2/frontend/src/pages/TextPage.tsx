import { useNavigate } from 'react-router-dom';

export default function TextPage() {
  const navigate = useNavigate();

  return (
    <div className="page-container text-page">
      <div className="page-header">
        <h1 className="page-title">📰 텍스트 팩트체크</h1>
        <p className="page-description">
          기사나 소셜 미디어 게시글의 허위 조작 텍스트 여부를 교차 검증하는 기능입니다.
        </p>
      </div>

      <div className="placeholder-panel">
        <div className="placeholder-icon-large">🚧</div>
        <h2 className="placeholder-heading">텍스트 모듈 연동 준비 중</h2>
        <p className="placeholder-detail">
          현재 텍스트 팩트체크 모델 및 전용 백엔드 API를 구축하는 단계입니다.
          <br />
          향후 팀원의 텍스트 분석 모듈 개발이 완료되면 이 페이지를 통해 바로 이용하실 수 있습니다.
        </p>

        <div className="placeholder-guidance">
          <h4>💡 현재 이용 가능한 서비스</h4>
          <p>
            현재는 <strong>영상 딥페이크 탐지 기능</strong>이 Modal 클라우드 GPU에 배포되어 즉시 분석 가능합니다.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/video')}>
            🎬 영상 딥페이크 탐지 바로가기
          </button>
        </div>
      </div>
    </div>
  );
}

