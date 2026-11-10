# 부경대 RTX 3090 얼굴 합성 연결

기존 프론트 `/generate`와 `/demo/generate`의 웹캠/사진 입력 → 원본 MP4 선택 → 작업 생성 → 상태 조회 → 결과 다운로드를 GPU API에 연결했습니다.
기본값은 실제 API입니다. 연결 실패 시 샘플 영상으로 대체하지 않습니다. 기존 Modal 탐지 API는 별도로 유지합니다.

## 현재 배포

- 서버 코드: `/home/pukyong/FactTraceAI_gpu`
- API 가상환경: `/home/pukyong/FactTraceAI_gpu/.api-venv` (Python 3.12)
- tmux 세션: `facttrace-gpu`
- API: 서버 내부 `127.0.0.1:8002` (외부 공개하지 않음)
- 모델: 기존 `facefusion` Conda 환경, `hyperswap_1a_256`, CUDA GPU 0
- 프론트 2단계에서 FaceFusion / FSGAN을 클릭하여 선택합니다. 작업별로 해당 Conda 환경에서 실행됩니다.
- FSGAN 결과는 브라우저 재생을 위해 H.264 MP4로 변환하며, 원본에 오디오가 있으면 함께 보존합니다.
- `GEN_MODEL`은 모델을 생략한 API 요청의 기본값이며, 프론트 선택은 작업마다 `model`로 전달됩니다.
- GPU 0에서 한 작업씩, 총 4개까지 접수. 실행 직전 `nvidia-smi`로 외부 작업이 있으면 실패 처리합니다.
- Uvicorn은 반드시 `--workers 1`로 실행합니다. GPU 잠금은 단일 프로세스 기준입니다. 완료·실패 작업 상태는 만료 시점까지 저장되어 재시작 후에도 조회 가능합니다.

## 원본 영상 5개 등록

로컬 저장소의 `video-generation/templates/`에 MP4 파일을 넣으세요. 파일명이 프론트 카드 제목이 됩니다.
로컬 파일을 GPU 서버에 전송하려면 저장소 루트 PowerShell에서:

```powershell
powershell -ExecutionPolicy Bypass -File .\video-generation\scripts\Sync-Templates.ps1
```

서버의 `/home/pukyong/FactTraceAI_gpu/video-generation/templates/`에 직접 넣어도 됩니다.
서버 폴더의 MP4는 API가 자동으로 읽습니다. 프론트에서 [목록 새로고침]을 누르면 실제 영상 미리보기가 표시됩니다.
로컬 폴더에만 넣으면 원격 서버에는 전송되지 않으므로 위 전송 단계를 거쳐야 합니다.
영상 길이는 임의 숫자로 표시하지 않습니다. 권장 입력은 사전 준비된 3~5초 H.264 MP4입니다.

## PC에서 실행

터미널 1에서 SSH 터널을 유지합니다. 비밀번호는 SSH 프롬프트에만 입력합니다.

```powershell
ssh -N -L 127.0.0.1:8002:127.0.0.1:8002 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 pukyong@112.175.148.181
```

터미널 2:

```powershell
cd dfvideo_modal_2/frontend
npm ci
npm run dev -- --host 127.0.0.1
```

`http://127.0.0.1:5173/generate` 접속 → 본인 얼굴/영상 사용 동의 → 카메라 촬영 또는 사진 선택 → 원본 영상 선택 → 합성.
카메라는 localhost 또는 HTTPS 환경에서 사용 가능합니다. 실제 카메라 권한과 촬영은 사용자 브라우저에서 확인해야 합니다.
개발 서버의 `/api/generate/*`는 SSH 터널로 전달됩니다. `/api/video/*`는 기존 Modal 탐지 경로입니다.

## 서버 재시작

기존 API를 중복 실행하지 마세요. 먼저 `tmux ls`, `ss -ltn '( sport = :8002 )'`로 확인합니다.
중지된 상태라면:

```bash
cd /home/pukyong/FactTraceAI_gpu/dfvideo_modal_2/gen_server
tmux new-session -d -s facttrace-gpu -c "$PWD" '/home/pukyong/FactTraceAI_gpu/.api-venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8002 --workers 1 > /home/pukyong/FactTraceAI_gpu/api.log 2>&1'
curl http://127.0.0.1:8002/health
```

새 서버 환경에서 설치할 경우 기존 모델 환경을 변경하지 않고 별도 venv에 `requirements.txt`를 설치합니다.
현재 서버에서는 시스템 Python의 venv용 ensurepip가 없어 기존 FaceFusion 환경의 Python으로 새 venv를 생성했습니다:

```bash
~/miniconda3/envs/facefusion/bin/python -m venv ~/FactTraceAI_gpu/.api-venv
~/FactTraceAI_gpu/.api-venv/bin/python -m pip install -r ~/FactTraceAI_gpu/dfvideo_modal_2/gen_server/requirements.txt
```

## API와 보관 정책

- `GET /health`: GPU 환경 상태
- `GET /templates`: 서버 폴더 자동 검색
- `GET /templates-static/{filename}`: MP4 미리보기
- `POST /jobs`: multipart `photo`, `template_id`, `consent=true`, `model=facefusion|fsgan`
- `GET /jobs/{id}`: queued / processing / done / error. 진행률은 단계 기준이며 프레임별 측정값이 아닙니다.
- `GET /jobs/{id}/result`: 합성 MP4
- `DELETE /jobs/{id}`: 프로세스 그룹 종료 및 파일 삭제

사진은 최대 10MB, JPEG/PNG/WEBP를 실제 디코딩한 뒤 EXIF 방향 보정 및 JPEG 변환합니다.
사진은 작업 처리 직후 삭제하고 결과·로그는 30분 만료 시 정리합니다(청소 주기 최대 60초).
브라우저에서 [처음부터 다시]를 누르면 해당 작업 파일을 즉시 삭제합니다. 서버 재시작 후 남은 만료 파일도 청소합니다.
개인 사진·영상·인증 정보와 가상환경은 Git에 넣지 않습니다. 저장소에 이미 추적되던 .env.local에는 개발 설정만 유지합니다.

HTTPS 공개 배포 시 VITE_GEN_API_BASE에 실제 HTTPS API 주소를 설정해 재빌드하고 GEN_CORS_ORIGINS에 프론트 주소를 지정해야 합니다.
현재 Vercel 설정에는 공개 GPU API 주소가 없으므로 Vercel 배포 연결은 구성하지 않았습니다. 현재 검증 경로는 PC 로컬과 SSH 터널입니다.

## 검증 기록 (2026-11-10)

- 프론트 API 테스트 19개 통과, TypeScript 및 Vite 빌드 성공.
- API 테스트 9개 통과: 자동 검색, 이미지/동의 검증, 결과/삭제, GPU 오류, 취소/대기열, 만료 파일 정리.
- 서버: RTX 3090 × 2 유휴 확인, FaceFusion ONNX Runtime 1.24.4 CUDA provider 확인.
- FSGAN PyTorch 1.12.1+cu116 / CUDA runtime 11.6 / torch.cuda.is_available() true 확인.
- 기존 서버 테스트 사진과 5초 영상으로 실제 FaceFusion API 합성 성공: 12.889초, 770344바이트 MP4.
- PC 프론트 프록시를 통한 결과 다운로드 SHA-256이 서버 결과와 일치하고 DELETE 204 확인.
- 검증용 결과는 삭제했습니다. 사용자가 준비한 5개 원본 MP4는 서버에 등록되어 있습니다.
