# 프로젝트 연결·예외 처리 점검 결과

점검일: 2026-10-27. 기준 브랜치 `feature/video-ui_v3`, 시작 커밋 `af2e4de`.

## 결론

영상 분석의 multipart 필드, API 경로, 응답 필드, 결과 컴포넌트 연결은 코드상 일치한다. 그러나 취소·재시도·응답 timeout·임시 파일 정리 등에 결함이 있어 로컬에서 수정하였다. 실제 Modal/GPU/Vercel 운영 환경은 호출하지 않았으므로 운영 연결 성공이나 전체 무결함을 보증하지 않는다.

## 수정 사항과 근거 파일

| 영역 | 발견 문제와 조치 | 코드 |
|---|---|---|
| 영상 요청 수명 | 재시도 시 취소 대상 controller가 달랐다. 페이지에서 요청을 소유하고 오래된 응답을 무시하도록 수정 | [VideoPage](../frontend/src/pages/VideoPage.tsx) |
| 업로드·초기화 | 선택 파일과 미리보기 상태가 남거나 URL 정리가 중복되었다. 선택 파일 기반 URL lifecycle, 50MiB 제한, 키보드 지원 추가 | [VideoUploader](../frontend/src/components/VideoUploader.tsx) |
| timeout·오류 | 헤더 수신 즉시 timeout을 해제하고 총 시간을 계산했다. JSON 수신 완료 시점까지 유지하고 HTTP/JSON/network/abort 처리를 보강 | [videoApi](../frontend/src/services/videoApi.ts) |
| 응답·점수 | TypeScript 타입 단언만 있어 런타임 검증이 없었다. 화면 사용 필드 검증 및 유한한 0~1 점수 검증 추가 | [video types](../frontend/src/types/video.ts) |
| 판정 UI | 반올림된 50점에서 REAL과 FAKE 배지가 충돌할 수 있었다. 배지에 서버 verdict 사용, 점수 누락과 UNKNOWN 구분 | [VideoAnalysisResult](../frontend/src/components/VideoAnalysisResult.tsx) |
| 업로드 백엔드 | 저장 중 실패 시 임시 파일이 남고 용량 제한이 없었다. chunk 읽기/빈 파일/50MiB 제한/예외 응답/정리 및 로깅 추가 | [영상 server](../video_module_v1/server.py) |
| SPA 배포 | 클라이언트 경로 직접 접근용 fallback이 없었다. 영상 API rewrite 뒤 index fallback 추가 | [vercel 설정](../frontend/vercel.json) |
| 합성 API | 상대 결과 URL이 프론트 origin으로 요청되고 삭제 실패가 숨겨졌다. origin 해석, 30초 요청 제한, 삭제 실패 전파 추가 | [genApi](../frontend/src/lib/genApi.ts) |
| 합성 UI | 폴링 중복/이탈 후 결과 반영/카메라 늦은 응답/미리보기 URL 동시 정리 문제를 보완. 임의 템플릿 fallback 제거, mock 및 삭제·재생 오류 표시 | [DemoGeneratePage](../frontend/src/pages/DemoGeneratePage.tsx) |
| 합성 작업 | 작업 시작 전 슬롯 예약 누락, 삭제 중 worker 계속 실행, GPU 설정 실패 시 모의 성공 문제를 보완. timeout·작업 취소·종료 cleanup 추가 | [합성 server](../gen_server/server.py) |
| Git 위생 | 점 없는 gitignore는 적용되지 않았다. 루트 ignore에 비밀 설정·cache·생성 방문객 데이터·영상·가중치 제외 추가 | [루트 ignore](../../.gitignore) |

## 검증 결과

- 프론트: `cd dfvideo_modal_2/frontend; npm test` — 17개 통과.
- 백엔드: 저장소 루트에서 `python -B -m pytest -p no:cacheprovider dfvideo_modal_2/tests -q` — 9개 통과.
- `npm run build` — TypeScript 및 Vite 빌드 통과.
- `npm run lint` — 오류 없음, 합성 페이지의 기존 React 경고 3개 잔존.
- `git diff --check` — 통과.
- 브라우저 모의 API: REAL/50점, FAKE/73점, UNKNOWN, 잘못된 응답 구조, HTTP 400 이후 재시도 취소, 초기화/다른 파일 선택 시 preview 제거 확인.
- 테스트 코드: [프론트 테스트](../frontend/tests/video-api.test.mjs), [백엔드 테스트](../tests/test_api_errors.py).
- Node MockTimers 실험적 API 경고는 테스트 런타임 경고이며 실패가 아니다.

자동 테스트는 fetch/Detector를 대체한다. 실제 GPU 모델 정확도, 실제 네트워크, FaceFusion 프로세스의 실제 실행 및 강제 종료까지 검증한 것은 아니다. 브라우저 테스트의 HTTP 400 및 ERR_ABORTED는 의도한 오류 주입 결과다.

## 실제 실행 전 해결해야 할 사항

### 1. 시연 영상이 준비되지 않음 — 우선순위 높음

[합성 템플릿 폴더](../gen_server/templates)의 MP4 4개와 [모의 결과 영상](../frontend/public/mock/result.mp4)은 모두 298바이트다. tpl_news.mp4를 Chromium에서 열었을 때 `mediaError=4`, `DEMUXER_ERROR_COULD_NOT_OPEN`, `readyState=0`을 확인했다. 이 파일은 정상 재생되지 않았다. 나머지는 크기만 확인했으며 각각 디코딩하지 않았다.

사용 동의를 받은 실제 MP4로 교체하고 미리보기·다운로드·분석을 다시 확인해야 한다. 임의의 실제 인물 영상을 내려받거나 합성 결과를 만들어 대체하지 않았다. 모의 결과는 실제 얼굴 합성이 아님을 화면에 표시하였다.

### 2. 운영 연결 및 모델 환경 — 미검증

- 로컬에 torch/cv2가 없어 모델 추론은 실행하지 않았다.
- Modal /health도 모델을 초기화할 수 있으므로 GPU 사용 승인이 없는 이번 점검에서는 호출하지 않았다.
- 코드상 Vite와 Vercel의 대상은 동일한 Modal URL이다. 실제 URL 활성 상태와 서버가 현재 로컬 코드와 같은 버전인지는 미확인이다.
- 배포 후 정상 REAL/FAKE, no-face UNKNOWN, 손상 영상 400, 큰 파일 413, 취소·timeout·새로고침을 확인해야 한다.
- `npm run preview`는 개발 server.proxy를 그대로 제공하는 운영 프록시가 아니다. 영상 연동 개발에는 `npm run dev`를 사용하고, 운영은 Vercel rewrite 또는 별도 프록시를 사용한다.
- 직접 Modal URL 호출로 전환할 경우 CORS를 별도로 검토한다.

### 3. 합성 운영·보관 관리 — 후속 설계 필요

- 작업 정보와 동시 실행 슬롯이 메모리에 있어 단일 프로세스 전제다. 여러 worker 및 재시작 복구가 구현되어 있지 않다.
- 재시작 전에 생성한 저장 파일은 메모리에서 추적되지 않아 기존 TTL 청소만으로 정리를 보장할 수 없다. 디스크 기반 시작 시 청소 및 보존 정책이 필요하다.
- 공개 운영용 인증/작업 소유권/업로드 빈도 제한이 없다. CORS는 인증이 아니다.
- 사진 검증은 MIME/파일명/용량 수준이며 실제 이미지 디코딩과 얼굴 존재 확인을 보장하지 않는다.
- FaceFusion 버전별 CLI 인자, 모델 파일, CUDA 환경, 재생 가능한 결과는 실제 환경에서 확인해야 한다.
- 취소된 생성 HTTP 요청 뒤 서버에서 이미 만든 작업은 UI가 job_id를 받지 못할 수 있어 TTL 정리가 필요하다. ‘항상 즉시 삭제’를 보장하지 않는다.
- 미사용 [GeneratePage](../frontend/src/pages/GeneratePage.tsx)와 [generateApi](../frontend/src/services/generateApi.ts)는 현재 라우트의 API 계약과 다르므로 재사용 전에 정리해야 한다.

### 4. 문서·이력 차이

- 첨부의 `margin <= 0 → FAKE`와 달리 [실제 추론 코드](../video_module_v1/predict_api.py)는 `< 0 → FAKE`, `>= 0 → REAL`이다. 추론 로직은 변경하지 않았다.
- Grad-CAM 및 텍스트 모듈을 수정하지 않았다. 텍스트는 준비 화면이다.
- Git이 이미 추적 중인 pyc는 ignore 추가로 자동 제거되지 않는다. 점검 중 발생한 pyc 변경은 되돌렸다.
- 기존 모델 성능·시간 수치는 이전 실험 기록이며 이번 테스트 결과가 아니다.
- 이번 변경은 로컬에만 있으며 commit/push/deploy는 실행하지 않았다.

## 보고서 작성

상세 작업 배경과 제출용 작성 지시는 [새 채팅 인수인계 프롬프트](./WEEKLY_REPORT_HANDOFF_2026-10-27.md)를 사용한다. 이번 주 커밋의 기능 개선과 이번 코드 점검에서 추가한 안정화 작업을 구분하여 기재한다.
