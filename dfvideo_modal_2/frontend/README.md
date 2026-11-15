# 팩트체크 AI — 공통 웹 프론트엔드 (React + Vite + TypeScript)

AI 기반 딥페이크 영상 탐지 및 텍스트 팩트체크 통합 웹 애플리케이션입니다.

---

## 1. 기술 스택 및 구조

- **프레임워크:** React 19 + TypeScript + Vite
- **라우팅:** `react-router-dom` (홈 `/`, 영상 탐지 `/video`, 텍스트 탐지 `/text`)
- **스타일링:** 반응형 순수 모던 CSS (`src/styles/global.css`)
- **백엔드 연동:** Modal 클라우드 서버리스 T4 GPU에 배포된 FastAPI 딥페이크 탐지 API

### 디렉터리 구조

```text
frontend/
├── .env.example              # 환경변수 템플릿
├── .env.local                # 로컬 환경설정 (Modal API 대상 URL 등)
├── index.html                # 엔트리 HTML
├── package.json
├── vite.config.ts            # 개발 프록시(/api/video) 설정
└── src/
    ├── main.tsx
    ├── App.tsx               # 라우트 및 공통 레이아웃
    ├── styles/
    │   └── global.css        # 전역 반응형 디자인 스타일시트
    ├── types/
    │   └── video.ts          # 백엔드 API 응답 및 상태 타입
    ├── services/
    │   └── videoApi.ts       # POST /predict?return_frames=true 연동 클라이언트
    ├── components/
    │   ├── Header.tsx        # 공통 네비게이션 헤더
    │   ├── VideoUploader.tsx # 파일 드래그앤드롭/선택/미리보기
    │   ├── VideoAnalysisResult.tsx # REAL/FAKE/UNKNOWN 판정 및 수치 요약
    │   └── FrameGallery.tsx  # 10개 검토 프레임 및 얼굴 크롭 갤러리
    └── pages/
        ├── HomePage.tsx      # 서비스 소개 및 모듈 선택
        ├── VideoPage.tsx     # 영상 탐지 페이지 (업로드 → 분석 → 결과)
        └── TextPage.tsx      # 텍스트 팩트체크 페이지 (연동 예정 플레이스홀더)
```

---

## 2. 개발 환경 실행 방법

### 1) 패키지 설치
```powershell
cd dfvideo_modal_2/frontend
npm install
```

### 2) 환경 변수 설정
`frontend/.env.local` 파일에 실제 배포된 Modal API HTTPS 주소를 입력합니다:
```env
MODAL_VIDEO_API_ORIGIN=https://goyeas52--dfvideo-web.us-east.modal.run
VITE_VIDEO_API_BASE_URL=/api/video
```

### 3) 로컬 개발 서버 실행
```powershell
npm run dev
```
브라우저에서 `http://localhost:5173` 접속.

### 4) 정적 타입 검사 및 프로덕션 빌드
```powershell
npm run build
```
빌드 산출물은 `dist/` 폴더에 생성됩니다.

---

## 3. 백엔드 연동 및 동작 방식

### 1) 개발 중 Vite 프록시 활용
- 로컬 개발 환경(`localhost:5173`)에서 `*.modal.run` 도메인을 브라우저에서 직접 호출하면 CORS 정책에 의해 차단될 수 있습니다.
- `vite.config.ts`의 `server.proxy` 설정을 통해 브라우저는 로컬 `/api/video/predict`로 요청을 보내고, Vite 개발 서버가 이를 `MODAL_VIDEO_API_ORIGIN`으로 중계(Proxy)합니다.

### 2) 주요 API 규격
- **엔드포인트:** `POST /predict?return_frames=true`
- **전송 형식:** `multipart/form-data`, 필드 이름 `file`
- **타임아웃:** 180초 (Cold Start 및 영상 인코딩/추론 시간 고려)
- **응답 판정:**
  - `REAL`: `video_margin >= 0` (진본)
  - `FAKE`: `video_margin < 0` (조작 의심)
  - `UNKNOWN`: 얼굴이 검출되지 않았거나 판정 불가인 경우 (`video_margin`은 `null`로 수신)

### 3) 시간 측정 지표 구분
- **서버 내부 연산 (`timing_ms.total`):** Modal 서버 안에서 디코딩, 얼굴 크롭, 3개 앙상블 신경망 추론에 소요된 순수 연산 시간입니다.
- **브라우저 요청 시간 (`elapsedMs`):** 브라우저가 네트워크를 통해 영상을 업로드하기 시작한 시점부터 최종 JSON 응답을 수신 완료할 때까지의 전체 HTTP 왕복 시간입니다. (업로드 대역폭에 따라 서버 연산 시간보다 큽니다)

---

## 4. 향후 텍스트 모듈 개발자를 위한 안내

- `src/pages/TextPage.tsx`는 향후 텍스트 팩트체크 모듈 연동을 위한 전용 페이지입니다.
- 텍스트 API가 준비되면:
  1. `src/types/text.ts` 생성
  2. `src/services/textApi.ts` 생성
  3. `src/pages/TextPage.tsx`에 입력 폼 및 결과 컴포넌트를 연결하시면 됩니다.

---

## 5. 배포 및 운영 시 주의사항

- **운영 환경에서의 CORS:** Vite 개발 서버의 Proxy 기능은 프로덕션 빌드 정적 호스팅(`dist/`)에서는 동작하지 않습니다. 운영 웹 서버에서 직접 배포하거나 Nginx/Cloudflare 등의 리버스 프록시를 구성하거나, 필요 시 `server.py`의 `CORSMiddleware` 설정을 검토해야 합니다.
- **비용 최적화:** `modal_app.py`는 유휴 5분(`scaledown_window=300`) 후 자동으로 컨테이너가 종료되도록 설정되어 있으므로, 불필요한 자동 폴링(`/health` 반복 호출 등)은 수행하지 않습니다.
