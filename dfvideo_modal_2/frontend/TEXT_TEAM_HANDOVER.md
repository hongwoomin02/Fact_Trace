# 텍스트 팩트체크 프론트엔드 개발 작업 지시서

## 1. 작업 전 준비 사항

### 브랜치 및 코드 받기

```powershell
# 1) 저장소 클론 (최초 1회)
git clone https://github.com/<팀-조직>/Fact_Check.git
cd Fact_Check

# 2) 영상 UI 브랜치에서 텍스트 전용 브랜치 분기
git fetch origin
git checkout feature/video-ui         # 영상 UI가 구현된 브랜치
git pull origin feature/video-ui      # 최신 반영
git checkout -b feature/text-ui       # 텍스트 작업용 새 브랜치 생성
```

> **중요:** 반드시 `feature/video-ui` 브랜치에서 분기하세요.
> 이 브랜치에 공통 프론트엔드(홈 화면, 헤더, 라우팅, 스타일)와 영상 탐지 페이지가 이미 구현되어 있습니다.
> `main` 브랜치에는 아직 프론트엔드가 없습니다.

### 개발 환경 확인

```powershell
node -v   # v18 이상 필요 (현재 v22.19.0)
npm -v    # v9 이상

cd dfvideo_modal_2/frontend
npm install
npm run dev
# → http://localhost:5173 접속하여 홈 화면, 영상 탐지, 텍스트 탐지 (플레이스홀더) 확인
```

---

## 2. 프로젝트 구조 이해

당신이 작업할 위치는 `dfvideo_modal_2/frontend/` 내부입니다.

```text
dfvideo_modal_2/frontend/src/
├── App.tsx                    # 라우터 (/, /video, /text) ← 라우트 이미 등록됨
├── main.tsx                   # 엔트리포인트
├── styles/
│   └── global.css             # 공통 스타일 (CSS 변수, 버튼, 카드, 레이아웃 등)
├── types/
│   └── video.ts               # 영상 API 타입 (참고용 — 수정하지 마세요)
├── services/
│   └── videoApi.ts            # 영상 API 호출 (참고용 — 수정하지 마세요)
├── components/
│   ├── Header.tsx             # 공통 헤더 (홈/영상 탐지/텍스트 탐지 네비게이션)
│   ├── VideoUploader.tsx      # 영상 전용 (수정하지 마세요)
│   ├── VideoAnalysisResult.tsx # 영상 전용 (수정하지 마세요)
│   └── FrameGallery.tsx       # 영상 전용 (수정하지 마세요)
└── pages/
    ├── HomePage.tsx           # 공통 홈 (수정 가능하나 영상 카드는 유지)
    ├── VideoPage.tsx          # 영상 전용 (수정하지 마세요)
    └── TextPage.tsx           # ⭐ 여기가 당신의 작업 대상입니다
```

### 당신이 생성/수정할 파일

| 작업 | 파일 경로 | 설명 |
|---|---|---|
| **새로 생성** | `src/types/text.ts` | 텍스트 분석 API 요청/응답 TypeScript 타입 정의 |
| **새로 생성** | `src/services/textApi.ts` | 텍스트 분석 API 호출 함수 |
| **새로 생성** | `src/components/TextInput.tsx` | 텍스트 입력 폼 (textarea 또는 URL 입력) |
| **새로 생성** | `src/components/TextAnalysisResult.tsx` | 텍스트 분석 결과 표시 |
| **수정** | `src/pages/TextPage.tsx` | 플레이스홀더를 실제 입력 → 분석 → 결과 흐름으로 교체 |
| **수정 (선택)** | `src/styles/global.css` | 텍스트 전용 CSS 클래스 추가 (기존 클래스는 수정하지 마세요) |
| **수정 (선택)** | `vite.config.ts` | 텍스트 API 프록시 추가 (필요 시) |

### 절대 수정하지 말 것

- `Video*` 컴포넌트 (VideoUploader, VideoAnalysisResult, FrameGallery)
- `videoApi.ts`, `types/video.ts`
- `modal_app.py`, `video_module_v1/` 전체 (백엔드)
- `Header.tsx`의 기존 네비게이션 구조 (링크 추가는 가능)

---

## 3. 개발 가이드

### 3-1. 영상 모듈의 패턴을 참고하세요

영상 모듈이 이미 완성되어 있으므로 같은 패턴을 따르면 코드 일관성을 유지할 수 있습니다:

```
types/text.ts        ← types/video.ts 구조 참고
services/textApi.ts  ← services/videoApi.ts 구조 참고
pages/TextPage.tsx   ← pages/VideoPage.tsx 구조 참고
```

### 3-2. 텍스트 API 프록시 설정 (필요 시)

텍스트 백엔드가 별도 서버에 배포된다면 `vite.config.ts`에 프록시를 추가하세요:

```ts
// vite.config.ts의 server.proxy에 추가
'/api/text': {
  target: env.TEXT_API_ORIGIN || 'http://localhost:8001',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/text/, ''),
},
```

`.env.local`에도 추가:
```env
TEXT_API_ORIGIN=https://실제-텍스트-API-주소
VITE_TEXT_API_BASE_URL=/api/text
```

### 3-3. TextPage.tsx 교체 예시

현재 플레이스홀더 상태인 `TextPage.tsx`를 아래와 같은 흐름으로 교체합니다:

```tsx
// 기본 골격 (영상 페이지와 같은 패턴)
export default function TextPage() {
  const [state, setState] = useState<TextAnalysisState>(INITIAL_STATE);
  
  const handleAnalyze = useCallback(async (text: string) => {
    setState({ status: 'loading', ... });
    try {
      const result = await analyzeText(text);
      setState({ status: 'done', result, ... });
    } catch (err) {
      setState({ status: 'error', error: err.message, ... });
    }
  }, []);

  return (
    <div className="page-container text-page">
      <TextInput onAnalyze={handleAnalyze} isAnalyzing={...} />
      {state.status === 'error' && <ErrorBox ... />}
      {state.status === 'done' && <TextAnalysisResult ... />}
    </div>
  );
}
```

### 3-4. 공통 스타일 활용

`global.css`에 이미 정의된 클래스를 재활용하세요:

- 레이아웃: `.page-container`, `.page-header`, `.page-title`, `.page-description`
- 버튼: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger-outline`
- 카드: `.metric-card`, `.metric-label`, `.metric-value`, `.metric-hint`
- 오류: `.error-alert-box`, `.error-alert-header`, `.error-alert-message`
- 경고: `.warnings-box`, `.warnings-title`, `.warnings-list`

텍스트 전용 스타일이 필요하면 `global.css` 하단에 `/* Text Page */` 섹션을 추가하세요.

---

## 4. 유의사항

1. **가짜 분석 결과를 만들지 마세요.** 텍스트 API가 아직 없다면 입력 폼만 구현하고 "API 연동 대기 중" 메시지를 표시하세요.
2. **`dangerouslySetInnerHTML`을 사용하지 마세요.** XSS 방지 원칙입니다.
3. **영상 탐지 컴포넌트를 수정하지 마세요.** 두 모듈은 독립적으로 동작해야 합니다.
4. **빌드 검증을 항상 하세요:** `npm run lint && npm run build` — 에러 0개여야 합니다.
5. **Git push 전 확인:** 영상 페이지가 여전히 정상 작동하는지 `/video`에서 확인하세요.

---

## 5. 작업 완료 후 체크리스트

- [ ] `npm run lint` → 0 warnings, 0 errors
- [ ] `npm run build` → 빌드 성공
- [ ] `/` 홈에서 영상/텍스트 카드 모두 정상 이동
- [ ] `/video` 영상 탐지 기능 기존과 동일하게 작동
- [ ] `/text` 텍스트 입력 → 분석 결과 표시 (또는 API 미연동 시 안내)
- [ ] 기존 `Video*` 컴포넌트 미수정 확인
- [ ] PR(Pull Request)을 `feature/video-ui` ← `feature/text-ui`로 생성

