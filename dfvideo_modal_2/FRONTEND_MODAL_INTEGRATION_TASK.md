# 영상·텍스트 통합 서비스 — 공통 프론트엔드 + 영상 Modal API 연동 작업 지시서

> **용도:** VS Code의 AI 코딩 도구 또는 Antigravity에 제공할 작업 명세서.  
> **현재 단계:** 공통 홈 화면과 **영상 탐지 페이지를 실제 동작하게 구현**한다. 텍스트는 향후 팀원이 붙일 자리를 마련한다.  
> **작업 언어:** 한국어 설명 및 UI, Windows/VS Code PowerShell 기준.

---

## A. AI 코딩 도구에게 가장 먼저 전달할 지시

당신은 이 폴더의 **기존 영상 탐지 백엔드를 보존하면서 React 프론트엔드를 실제 구현하는 개발자**다. 이 문서를 읽은 뒤 프로젝트의 현존 파일을 먼저 확인하고, **설명만 하지 말고 실제 필요한 파일을 생성·수정**하라.

1. 프로젝트 파일을 스캔해 `modal_app.py`, `video_module_v1/server.py`, `video_module_v1/predict_api.py`, `requirements.txt`와 기존 프론트엔드 유무를 확인한다. 이 문서와 실제 코드가 충돌하면 **실제 코드가 우선**이며 차이를 보고한다.
2. 기존 로컬 작업물·Git 변경사항은 보존한다. 이미 있는 `frontend/`를 초기화하거나 덮어쓰지 않는다. 기존 `modal_app.py`, `predict_api.py`, 모델·가중치·학습 코드는 원칙적으로 수정하지 않는다.
3. `frontend/`에 **React + Vite + TypeScript** 기반 공통 프론트엔드를 구현한다. 필요 시 `react-router-dom` 등을 사용하되 불필요한 라이브러리는 피한다. 처음에는 깔끔한 CSS만으로 충분하다.
4. **홈 → 영상 탐지 → 결과 확인** 흐름을 완성하고, 텍스트 탐지 메뉴/빈 페이지는 향후 연동을 위한 자리만 마련한다. 텍스트 모델의 결과를 임의로 구현하거나 가짜 판정하지 않는다.
5. 현재 백엔드는 **Modal에 이미 배포**되어 있다. 가능하면 기존 배포 URL을 이용해 연결하며 백엔드를 로컬 GPU에서 다시 띄우려 하지 않는다. 업로드한 ZIP에 모델 가중치나 샘플 동영상이 없을 수 있다.
6. 개발 환경에서는 **Vite 개발 서버 프록시**로 Modal API를 호출할 수 있게 한다. 실제 배포 때는 정식 API 주소/CORS 또는 적절한 운영 프록시가 필요함을 분명히 한다.
7. 사용자가 명시적으로 승인하기 전에는 **`modal deploy`, `modal app stop`, GPU 변경, 공개 배포, Git push, 데이터 삭제를 실행하지 않는다.** GPU 비용이 드는 호출은 최소화하며 테스트 전 알려준다.
8. 실제 파일을 작성한 후 `npm install`, `npm run build`와 가능한 정적 점검을 수행한다. API가 활성화되어 있고 허용될 때에만 실제 영상 업로드 테스트를 수행한다. 실행이 안 되면 이유와 남은 단계를 정확히 설명한다.
9. 구현 결과를 **추가/수정한 파일, 실행 명령, 연동 여부, 남은 문제, 배포 전 준비사항** 형태로 간결히 한국어로 보고한다.

---

## 1. 현재 확인된 백엔드 사실 — 함부로 바꾸지 말 것

이 명세는 사용자가 제공한 `dfvideo_modal_2 (2).zip` 내부 코드 확인을 바탕으로 작성했다.

### 코드 위치

```text
[현재 프로젝트 루트]/
├── modal_app.py                 # 기존 Modal 배포 엔트리포인트
├── video_module_v1/
│   ├── server.py                # FastAPI /, /health, /predict, /docs
│   ├── predict_api.py           # 모델 추론, API_VERSION='0.2'
│   ├── requirements.txt
│   ├── README_인계문서.md
│   └── ...
├── docs/VERSIONS.md
└── results/*.csv
```

`modal_app.py`에서는 다음과 같이 운영한다.

- Modal 앱: `dfvideo` / Environment: `main`
- 모델: `v6`, 3개 시드 앙상블 / NVIDIA **T4** GPU
- 서비스: `@modal.asgi_app()`으로 `server.app` 반환
- 실행 제한 `timeout=600`, 유휴 축소 `scaledown_window=300`, `max_containers=1`
- 컨테이너 기동 시 `server.det()`로 모델을 올린다.
- **현재 배포 주소는 대시보드에서 최신 값 확인**. Modal 대시보드 `modal.com/apps/...`와 **실제 HTTPS `modal.run` API 주소를 혼동하지 않는다.**
- **이 프론트 작업을 위해 Modal 코드를 재배포할 필요는 없다.** 단, 운영 CORS 설정을 바꿔야 한다면 코드를 검토하고 별도 승인 후 재배포한다.

### 확인된 API

| Method | Path | 사용처 |
|---|---|---|
| GET | `/health` | 모델/서버 상태 (GPU 기동을 유발할 수 있으므로 자동 반복 호출 금지) |
| POST | `/predict?return_frames=true` | `multipart/form-data`, 필드 이름 **`file`** |
| GET | `/docs` | FastAPI API 문서 |
| GET | `/` | 기존 Modal 테스트용 HTML (새 공통 프론트와 별도) |

영상 POST 요청 시 **JSON으로 아래 필드들이 실제로 반환됨**.

```ts
export type VideoVerdict = 'REAL' | 'FAKE' | 'UNKNOWN';
export interface VideoFrame {
  frame_index: number;
  time_sec: number;
  status: string;                 // 예: 'ok', 'no_face'
  face_detected: boolean;
  bbox: number[] | null;
  margin: number | null;
  verdict: 'REAL' | 'FAKE' | null;
  crop_jpeg_base64?: string;      // 얼굴 검출 성공 시 반환 가능
}
export interface VideoPredictResponse {
  api_version: string;           // 현재 '0.2'
  model: string;                 // 현재 'v6'
  n_seeds: number;
  device: string;
  video: string;
  n_frames_total: number;
  fps: number;
  n_frames_sampled: number;
  n_frames_used: number;
  threshold: number;
  verdict: VideoVerdict;
  video_margin: number | null;
  seed_margins: number[] | null;
  fake_score_display: number | null;
  frames: VideoFrame[];
  warnings: string[];
  timing_ms: {
    decode_detect_crop: number;
    model: number;
    total: number;
  };
}
```

- `video_margin < 0`이면 FAKE, `>= 0`이면 REAL. **이 점수는 신뢰도 퍼센트나 조작의 확정 증거가 아님**. 확률로 임의 변환하지 않는다.
- `UNKNOWN`인 경우 `video_margin`, `fake_score_display`가 `null`일 수 있다. 화면에서는 **'판정 불가' 또는 '-'**로 표시한다. 문자열 `null`을 그대로 보여주지 않는다.
- `frames[].crop_jpeg_base64`가 있으면 `data:image/jpeg;base64,${...}` 형태로 얼굴 크롭 썸네일을 출력한다. 값이 없는 프레임은 이미지가 없는 상태로 처리한다.
- `warnings`는 사용자에게 읽기 좋게 보여준다.
- 업로드 오류는 `HTTP 400` + `{ "detail": "..." }`로 반환할 수 있고, 현재 일부 `detail`에는 서버 내부 `/tmp/...` 경로가 들어간다. **일반 사용자에게 서버 임시 파일 경로를 노출하지 말고** '영상 파일을 열 수 없습니다. 형식이나 파일 손상 여부를 확인해 주세요.' 같은 안내를 제공한다.
- 서버는 현재 파일 확장자/용량 제한을 API 수준에서 엄격히 검증하지 않는다. **프론트의 제한은 UX 목적**이며 서버 보안을 대체하지 않는다.

---

## 2. 이번 단계 목표와 미구현 범위

### 반드시 구현

1. `/` 홈: 서비스명, 짧은 소개, **영상 탐지 / 텍스트 탐지** 선택 카드.
2. `/video` 영상 탐지: 파일 선택(가능하면 드래그앤드롭), 파일명·크기, 영상 미리보기, 분석 버튼, 취소/초기화, 분석 중 상태 표시.
3. 실제 Modal `POST /predict?return_frames=true` 연동: 백엔드 응답을 그대로 파싱해 REAL/FAKE/UNKNOWN, margin, 모델/버전, 10개 내외의 검토 프레임, 경고 문구, 서버 처리시간 등을 표시.
4. 실제 브라우저 전체 요청시간을 `performance.now()` 등으로 **요청 시작부터 응답 수신까지** 측정해 표시한다. `timing_ms.total`과 **서로 다른 값**임을 UI와 README에 설명한다. 결과 화면 렌더링 시간은 별도 계측하지 않은 이상 '화면 표시 완료까지'라고 쓰지 않는다.
5. `/text` 텍스트 탐지: **'텍스트 모듈 연동 예정'** 플레이스홀더와 공통 레이아웃. API와 모델을 아직 갖추지 않았으므로 가짜 분석 버튼·점수를 만들지 않는다.
6. 공통 헤더/내비게이션, 모바일 화면 대응, 로딩/오류/빈 화면, 접근 가능한 버튼/라벨, `.env.example`, 실행 방법 README.

### 지금은 만들지 않음

- 사용자 로그인, DB, 히스토리 보관, 유료 결제, 영상 생성 AI 모델, 텍스트 AI 추론 API, 분석 결과 점수 결합.
- GPU 생성 서버를 프론트 프로젝트에 포함하지 않음. **생성 시스템은 탐지 API와 독립**인 향후 선택 기능이다.

---

## 3. 권장 디렉터리 구조

프로젝트 루트 바로 아래 `frontend/`를 만든다. **프론트엔드를 `video_module_v1/` 내부에 넣거나 Modal 이미지에 복사하지 않는다.**

```text
[프로젝트 루트]/
├── modal_app.py                  # 유지
├── video_module_v1/              # 유지
├── docs/
├── results/
└── frontend/                     # 새로 작성
    ├── README.md
    ├── .env.example
    ├── .env.local                 # 사용자가 로컬에서 작성, Git 제외
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── styles/
        │   └── global.css
        ├── components/
        │   ├── Header.tsx
        │   ├── VideoUploader.tsx
        │   ├── VideoAnalysisResult.tsx
        │   └── FrameGallery.tsx
        ├── pages/
        │   ├── HomePage.tsx
        │   ├── VideoPage.tsx
        │   └── TextPage.tsx
        ├── services/
        │   └── videoApi.ts
        └── types/
            └── video.ts
```

필요한 파일만 생성하고 상황에 따라 파일을 합쳐도 된다. 전체 코드는 실제 실행되는 수준으로 작성한다.

---

## 4. 디자인 및 UX 요구사항

- 배경은 밝고 단정한 대시보드 스타일 또는 차분한 다크 스타일 중 하나를 택해 **일관되게** 구현한다.
- 홈 화면: 서비스 설명과 `영상 탐지 시작`, `텍스트 탐지(준비 중)` 카드.
- 영상 화면: **업로드 영역 → 원본 미리보기 → 분석 버튼 → 진행 상태 → 결과/검토 프레임** 순서.
- 결과의 REAL/FAKE/UNKNOWN을 색상과 **텍스트**로 함께 구분한다. `UNKNOWN`을 FAKE로 오인하지 않게 한다.
- 검토 프레임은 그리드로 배치하고 프레임 번호·시간·margin·판정을 함께 표시한다.
- '영상 점수'는 원래 margin 값으로 표기하고 백분율 확률처럼 해석하지 않는다.
- 영상 선택을 바꾸면 이전 결과·경고가 초기화된다. 분석 중 중복 클릭을 차단한다.
- `URL.createObjectURL()`로 미리보기할 경우 해제 시 `URL.revokeObjectURL()`로 메모리 누수를 방지한다.
- 응답 JSON 내 Base64를 무작정 화면에 덤프하지 않는다. 필요한 값만 UI로 표현한다. `dangerouslySetInnerHTML` 사용 금지.
- 텍스트팀이 나중에 `TextPage.tsx`와 `services/textApi.ts`를 개발하기 쉽도록 공통 레이아웃과 결과 컴포넌트를 분리한다.
- 실제 영상 생성 체험 기능은 **이번 범위 밖**이므로 버튼을 활성화하지 않는다.

---

## 5. Modal 연결 방식 — 개발과 운영을 분리

### 5-1. 개발 중: Vite 프록시 사용 (우선 추천)

별도 `localhost:5173` 프론트에서 `*.modal.run`을 직접 호출하면 **CORS 문제가 생길 수 있다**. `vite.config.ts`의 `server.proxy`를 사용하면 로컬 개발 서버가 `/api/video/*`를 실제 Modal API로 전달해 로컬 개발을 시작할 수 있다.

예시 설정 개념:

```ts
// 프론트 코드에서는 아래 로컬 경로로 호출
const baseUrl = import.meta.env.VITE_VIDEO_API_BASE_URL;
const endpoint = `${baseUrl.replace(/\/$/, '')}/predict?return_frames=true`;

// 개발용 .env.local 예시
// MODAL_VIDEO_API_ORIGIN=https://실제-주소.modal.run
// VITE_VIDEO_API_BASE_URL=/api/video

// vite.config.ts server.proxy 예시 (실제 앱에 맞게 작성)
// '/api/video': {
//   target: process.env.MODAL_VIDEO_API_ORIGIN,
//   changeOrigin: true,
//   rewrite: (path) => path.replace(/^\/api\/video/, ''),
// }
```

`vite.config.ts`에서 `.env.local` 값을 읽을 때는 Vite의 `loadEnv(mode, process.cwd(), '')` 등을 사용해 올바르게 로드한다. **불완전한 `process.env` 예시를 그대로 복붙하지 말고** 개발 서버를 실행해 실제 프록시가 동작하는지 확인한다.

`frontend/.env.example`에는 값의 예시만 쓰고 실제 URL은 **사용자가 `.env.local`에 입력**한다. URL은 `.modal.run`의 **실제 API 주소**이고 대시보드 주소가 아니다. 서브경로가 있다면 중복 `/predict` 또는 `/api/video`가 붙지 않게 처리한다.

`GET /health`도 `/api/video/health`로 연결할 수 있지만, 자동 폴링이나 페이지 로딩 때의 자동 워밍업은 비용 발생 및 Cold Start를 유발할 수 있으므로 하지 않는다.

### 5-2. 실제 외부 웹 배포 시

- **Vite 개발 서버의 proxy는 운영 웹서비스에서 그대로 동작하지 않는다.**
- 운영 프론트엔드가 Modal API를 **직접 호출**한다면 배포 프론트 주소를 `server.py` FastAPI의 `CORSMiddleware` 허용 origin에 등록해야 할 수 있다. 기존 백엔드 변경이 필요하면 **변경안만 만들고 사용자 승인 전에는 재배포하지 말 것**.
- 운영 호스팅의 중계 프록시를 택할 수도 있으나 **대용량 영상 업로드와 40초 이상 지연**에 대한 바디 크기·시간 제한을 검증해야 한다. 제한을 확인하지 않은 채 일반적인 서버리스 프록시를 사용하지 않는다.
- API 주소는 환경변수에서 주입한다. **Vite의 `VITE_` 접두사 환경변수는 브라우저에 노출**되므로 비밀 토큰을 저장하지 않는다.
- 기존 공개 Modal URL이 외부에서 호출될 수 있다는 점을 인식하고, 발표용 서비스에서는 접근 정책/비용을 팀과 협의한다.

### 5-3. 네트워크 요청 구현 조건

- `FormData`에 `file`로 동영상을 첨부한다. `multipart/form-data`의 `Content-Type`을 직접 지정하지 않는다(브라우저가 boundary 설정).
- 메서드 `POST`, 경로 `/predict?return_frames=true`.
- `response.ok` 검증 후 JSON 처리. 400, 404, 500, 네트워크 오류, 빈 응답을 각각 적절히 안내.
- 영상 업로드가 크고 Cold Start가 발생할 수 있다. **30초 같은 짧은 타임아웃을 설정하지 않는다.** 필요 시 명시적 제한(예: 180초)을 두되 쉽게 변경할 수 있게 만든다. 서버의 `timeout=600`과 브라우저 타임아웃은 다른 개념이다.
- `AbortController`로 사용자가 취소/재시도할 수 있게 해도 좋다. **브라우저 요청 취소가 Modal GPU 서버 작업 취소를 보장하지 않는다**는 점을 명시한다.
- 응답시간은 실제 `fetch()` 요청 시작부터 결과 JSON 수신까지의 측정값임을 명시한다. 서버 자체의 `timing_ms.total`과 구분한다.

---

## 6. 구현 순서 — 한 단계씩 실행, 각 단계 결과 점검

### STEP 1. 기존 코드·환경 점검

- 루트 및 `frontend/` 존재 확인, Git 변경 사항 확인.
- `node -v`, `npm -v` 확인. 최신 Vite 요구 버전을 충족하지 않으면 설치·업그레이드를 안내한다.
- 기존 ZIP에 **`weights/`, `samples/`가 포함되지 않았던 점**을 인지하되, 현재 로컬 폴더에는 존재할 수도 있으므로 직접 확인한다.

### STEP 2. 프론트엔드 프로젝트 구성

프론트엔드가 없을 때만 루트에서 아래 명령을 실행한다.

```powershell
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

이미 `frontend/`가 있으면 **기존 파일을 유지**한 채 필요한 패키지와 구성만 보완한다.

### STEP 3. 화면 구성

- `HomePage`, `VideoPage`, `TextPage` 및 공통 헤더/내비게이션 작성.
- 별도 라우트 `/`, `/video`, `/text`가 정상 이동하는지 확인.
- 반응형 스타일과 로딩·빈 화면 구현.

### STEP 4. API 연동

- `types/video.ts`에 실제 응답 타입 선언.
- `services/videoApi.ts`에 분리된 HTTP 함수 작성.
- `.env.example`, `.env.local`, `vite.config.ts` 프록시 설정.
- `VideoPage`에서 영상 전송, 응답 처리, 결과 출력 연결.
- 이전 결과 초기화, UNKNOWN/null, 400 오류, 네트워크 지연, 프레임 Base64 미표시 문제 검증.

### STEP 5. 검증

```powershell
# frontend 폴더에서
npm run dev
npm run build
```

가능하면 `npm run lint`도 실행한다.

**중요:** Modal 컨테이너를 깨우는 `/health`나 동영상 분석은 GPU 비용이 발생할 수 있으므로, 자동 반복 테스트는 하지 않는다. 사용자가 API URL과 테스트 파일을 확인해 준 후 제한된 횟수로 실제 요청을 검증한다. API가 꺼져 있으면 UI와 빌드까지 검증 후 **'실제 서버 연동 검증 대기'**라고 보고한다. 

### STEP 6. 작업 결과 보고

- 구현 파일 목록 / 핵심 화면 기능
- 개발 서버 실행 방법과 접속 주소
- Modal API 연결 방식 및 API URL 설정 파일 위치
- 빌드·lint·실제 요청 테스트 성공 여부(미확인 사항을 성공이라고 하지 않기)
- 운영 배포 전 남은 CORS·서버 사용료·프론트 배포 작업
- **어떤 파일도 몰래 Git push 또는 Modal 재배포하지 않았는지** 확인

---

## 7. 완료 판정 체크리스트

- [ ] 홈에서 영상/텍스트 메뉴를 볼 수 있고 `/video`, `/text`가 정상 이동한다.
- [ ] 영상 파일을 고르면 이름, 크기, 미리보기가 나온다.
- [ ] 분석 중 버튼 중복 요청이 차단되고 진행 중 안내가 나온다.
- [ ] **실제 Modal API** 응답을 받아 FAKE와 REAL을 구분해서 보여준다(테스트 영상이 제공된 경우).
- [ ] 얼굴이 없는 영상은 **UNKNOWN·판정 불가**로 표시하며 `null`을 그대로 노출하지 않는다.
- [ ] 검토 프레임 이미지를 정상 표시하고, 빠진 Base64에도 화면이 깨지지 않는다.
- [ ] `timing_ms.total`(서버 내부)과 브라우저 HTTP 소요시간을 서로 다른 항목으로 표기한다.
- [ ] 잘못된 파일/서버 오류의 메시지에 `/tmp/...`가 노출되지 않는다.
- [ ] `npm run build` 성공.
- [ ] 기존 Modal 앱을 재배포하지 않고 현재 배포 서비스와 연동할 수 있다(사용자 제공 URL·실제 요청 확인 필요).
- [ ] 텍스트 분석은 **미연동 상태임을 정직하게 표시**한다.

---

## 8. 중간 발표 및 관람객 시연 방향 — 개발 범위 안내

**중간 발표용 권장 MVP는 '미리 준비된 영상 → 현장에서 실제 탐지 API 실행'이다.**

- 관람객이 `REAL/FAKE` 예시 영상을 골라 **직접 분석 버튼을 누르는 체험**은 진짜 모델 실행을 포함하므로 의미 있는 실시간 시연이다. 사전에 준비된 파일이라는 사실을 숨기지 않는다.
- 관람객 본인 영상 업로드 기능도 제공하되 파일 크기, 초상권, 개인정보 취급, 모델 한계를 안내한다.
- **미리 계산한 판정 결과를 실제 AI 추론 결과인 것처럼 보여주지 않는다.** Modal이 중지됐거나 실패하면 서버 미연결로 안내한다.
- 현장에서 **사진+영상으로 합성 영상을 직접 생성**하는 방식은 별도의 생성 GPU가 필요할 수 있고, 이전 실험 기준 **약 8~20분** 걸렸다. 새 고성능 GPU 사용 시 시간이 얼마나 단축될지는 아직 미확인이다.
- 따라서 팀원이 유료 GPU를 알아보고 나면 같은 샘플·설정으로 **생성 시간, 비용, 동시 실행 가능 수, 업로드/다운로드 시간, 생성 실패율**을 측정해 시연 옵션 추가를 결정한다.
- 실제 생성 체험을 추가하더라도 영상 합성 파이프라인과 **현재 Modal 딥페이크 탐지 API를 혼동하거나 한 컨테이너에 묶지 않는다.**
- 영상 생성은 당사자의 동의를 받은 이미지/영상 및 사용이 허용된 소재로 진행하고, 합성 콘텐츠임을 명확하게 고지한다.
- 시연 직전 미리 실제 탐지 요청 1회로 **Warm 상태를 확인**할 수 있으나, 준비 시점과 `scaledown_window=300`을 고려하고 GPU 사용료에 주의한다.

### 나중에 추가할 수 있는 확장 아이디어 (이번 작업에서는 구현 금지)

1. 검증된 짧은 REAL/FAKE 체험 영상 목록 선택 UI (적법하게 보관/공개 가능한 파일 준비 후).
2. 팀원이 구축한 GPU 생성 서버와 비동기 작업 큐/상태 조회 연동(생성 시간이 충분히 짧아질 때).
3. 텍스트 모듈 API 완성 후 `TextPage` 연결, 두 결과는 통합 웹에서 **독립적으로 표시**.

---

## 9. 질문이 필요한 경우 (최소한만)

사용자에게 반드시 확인할 항목은 다음 두 가지뿐이며, 나머지는 소스코드를 보고 스스로 합리적으로 결정한다.

1. **현재 실제 `https://...modal.run` 영상 API 주소**. `modal_app.py`만으로 배포 시점의 유효 주소를 확정할 수 없을 수 있다.
2. **실제 요청 테스트에 사용할 동영상 파일 1개**와 GPU 호출을 실행해도 되는지.

위 두 가지가 없어도 공통 UI 구현, 타입/서비스 코드 작성, 개발용 프록시 설정, 빌드 점검까지 진행한다. 실서버 테스트만 '대기'로 남긴다.

---

## 10. 참고 공식 문서

- Vite 개발 서버 프록시: https://vite.dev/config/server-options/#server-proxy
- FastAPI CORS: https://fastapi.tiangolo.com/tutorial/cors/
- Modal ASGI 앱: https://modal.com/docs/guide/webhooks

**작업 시작:** 먼저 루트 구조와 기존 서버 코드를 확인하고, 안전한 구현 계획을 5줄 이내로 공유한 뒤 실제 프론트 파일 생성부터 진행하라.
