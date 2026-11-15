# 딥페이크 영상 탐지 모듈 — 백엔드 인계문서

> 백엔드를 처음 해봐도 이 문서 순서대로만 하면 된다.
> 막히면 `CLAUDE_시작프롬프트.md`를 Claude 새 대화에 붙여넣고 같이 진행한다.

---

## 0. 한 줄 요약

연구 담당이 만든 딥페이크 탐지 모델을 **내 컴퓨터에서 웹 서버로 띄우고, 영상을 올리면 판정 결과(JSON)가 나오는 것을 보여주면** 이번 주 할 일은 끝이다.

---

## 1. 백엔드가 뭔지 (처음이면 읽기)

```
[사용자 / 프론트 화면]  --영상 업로드-->  [백엔드 서버]  --함수 호출-->  [탐지 모델]
                        <--결과 JSON---                <--판정 결과---
```

| 용어 | 뜻 |
|---|---|
| 서버 | 요청을 기다리다가 받으면 처리해서 돌려주는 프로그램. 여기서는 `server.py` |
| API | 서버에 "이렇게 요청하면 이렇게 답한다"는 약속. 우리는 `/predict`, `/health` 두 개 |
| JSON | 결과를 담는 텍스트 형식. `{"verdict": "FAKE", "video_margin": -3.2, ...}` |
| localhost | "내 컴퓨터 자신". `http://localhost:8000` = 내 컴퓨터에서 도는 서버의 8000번 문 |
| FastAPI | 파이썬으로 API 서버를 쉽게 만드는 도구. `/docs` 페이지를 자동으로 만들어줌 |

**GPU 서버가 꼭 필요한가?** 이번 주는 **아니다.** 기본 모델(v4)은 일반 노트북 CPU로 동작한다(영상 1편 수 초~수십 초). 서버를 어디에 둘지는 5절 참고.

---

## 2. 이번 주 할 일 (교수님 요구 범위)

교수님 피드백: *"현재 모델을 서비스에서 호출할 수 있게 만드는 것이 우선. JSON·호출 함수·프레임 반환을 구현했다면 그 실행 예시를 제출."*

| # | 할 일 | 완료 기준 |
|---|---|---|
| 1 | 설치 (3절) | 오류 없이 끝남 |
| 2 | `python env_check.py` | 마지막 줄 `★ 최종: PASS` |
| 3 | `python make_examples.py` | `examples/v4/요약.md`와 JSON 3개, 얼굴 이미지 생성 |
| 4 | `python server.py` 후 브라우저 `http://localhost:8000`에서 영상 업로드 | 판정·얼굴 이미지가 화면에 나옴 |
| 5 | 캡처해서 제출물 만들기 | 서버 실행 창, 테스트 화면, `/docs` 화면, `요약.md` |
| 6 | 내 컴퓨터 사양(CPU/GPU/RAM)과 처리 시간을 연구 담당에게 공유 | 서버 결정(5절)에 필요 |

**하지 않아도 되는 것**: 회원가입·DB·디자인·클라우드 배포. 이번 주는 "호출이 된다"를 보여주는 것까지.

---

## 3. 설치 (처음 한 번)

### 3-1. Miniconda 설치
파이썬 버전을 연구 환경과 맞추려고 쓴다. https://docs.conda.io/en/latest/miniconda.html 에서 내 OS용을 받아 설치.
- Windows: 설치 후 시작 메뉴의 **Anaconda Prompt** 사용
- Mac: 터미널 사용

### 3-2. 패키지 폴더로 이동
받은 `video_module_v1.zip` 압축을 푼다. 경로에 한글·공백이 없는 곳이 안전하다 (예: `C:\dfvideo\video_module_v1`).
```bash
cd C:\dfvideo\video_module_v1        # Mac: cd ~/dfvideo/video_module_v1
```

### 3-3. 가상환경 만들기
`env_reference.json`을 메모장으로 열어 `"python": "3.xx.x"`의 앞 두 자리를 확인한다 (예: 3.11).
```bash
conda create -n dfvideo python=3.11 -y     # 3.11 자리에 확인한 버전
conda activate dfvideo
```
이후 작업할 때마다 창을 새로 열면 `conda activate dfvideo`부터 한다.

### 3-4. 라이브러리 설치
```bash
pip install -r requirements.txt
```
10~20분 걸릴 수 있다. 빨간 ERROR로 끝나면 전체 메시지를 복사해 Claude에게 붙여넣는다.

**NVIDIA GPU가 있는 컴퓨터라면** (없으면 건너뛰기): 위 설치 후
```bash
nvidia-smi        # 오른쪽 위 CUDA Version 확인
pip install torch==<requirements.txt의 torch 버전> torchvision==<같은 파일의 버전> --index-url https://download.pytorch.org/whl/cu121
```
`cu121`은 CUDA 버전에 맞춰 바꾼다. 모르겠으면 Claude에게 `nvidia-smi` 결과를 보여주고 물어본다.

### 3-5. 인터넷 없는 곳에서도 동작
얼굴 검출 가중치(`weights/retinaface.h5`)와 모델 구조가 패키지에 들어 있어서 실행 중 다운로드가 없다.

---

## 4. 검증 → 실행 예시 → 서버

```bash
python env_check.py          # ① 검증. PASS가 나와야 다음으로
python make_examples.py      # ② 실행 예시 자동 생성 -> examples/v4/
python server.py             # ③ 서버 실행. "준비 완료"가 뜨면
```
③ 상태에서 브라우저로:
- `http://localhost:8000` → 영상 올려보는 테스트 화면
- `http://localhost:8000/docs` → API 문서. `POST /predict` → Try it out → 파일 선택 → Execute 로도 호출 가능
- `http://localhost:8000/health` → `{"status":"ok", ...}`

서버 끄기: 서버 창에서 `Ctrl + C`

**env_check가 FAIL이면** 서버 작업을 멈추고 출력 전체를 연구 담당에게 보낸다. 버전이 다르다고 나와도 최종 PASS면 진행해도 된다.

---

## 5. 서버를 어디에 둘까 (팀 결정 사항, 이번 주 필수 아님)

| 방식 | 비용 | 장점 | 단점 |
|---|---|---|---|
| **A. 팀원 노트북/학교 PC + CPU (v4)** | 무료 | 지금 바로 가능. 이번 주 제출은 이걸로 충분 | 컴퓨터가 켜져 있어야 함. 외부 접속하려면 터널 도구(Cloudflare Tunnel, ngrok) 필요 |
| **B. 학교/학과 GPU 서버** | 무료(대부분) | v6도 빠름 | 지도교수·학과에 문의 필요 |
| **C. Modal (서버리스 GPU)** | 월 $30 무료 크레딧, 요청 처리 중인 초만 과금 | 켜둘 필요 없음, 쓸 때만 GPU | 코드를 Modal 방식으로 조금 옮겨야 함 |
| D. 클라우드 VM (AWS/GCP, RunPod 등) | 켜둔 시간만큼 과금 | 자유도 높음 | 끄는 걸 잊으면 요금 폭탄. 비추천 |

연구 담당 권장: **이번 주 A → 그 다음 B를 교수님께 문의 → 안 되면 C.**

---

## 6. 모델에 대해 알아야 할 것

**처리 순서** (연구와 동일, 바꾸면 안 됨): 영상에서 10프레임 균등 추출 → 얼굴 검출(RetinaFace) → 얼굴을 15% 여유 두고 잘라 224×224 → 모델이 프레임마다 점수 → 10프레임 평균 → 모델 3개(seed) 평균 → **0보다 작으면 FAKE**

| | v4 (기본) | v6 |
|---|---|---|
| 특징 | 가볍고 빠름, CPU 가능 | 처음 보는 합성 방식에 강함 |
| 모델 계산 시간 (T4 GPU / CPU, 3 seed, 영상 1편) | 83 ms / 3.2 초 | 369 ms / 27.7 초 |
| 크기 | 약 340 MB | 약 1.2 GB |

위 시간은 모델만이다. 얼굴 검출을 포함한 전체 시간은 `make_examples.py`의 처리 시간이 첫 측정값이 된다.

**성능** (3 seed 앙상블, 임계값 0 고정. 발표에 인용할 때 이 조건도 적을 것)

칸 순서: F1 / 가짜 탐지율 / 진짜를 가짜로 오판한 비율

| 평가셋 | v4 | v6 |
|---|---|---|
| in-domain 596편 | 0.973 / 0.954 / 0.007 | 0.951 / 0.928 / 0.024 |
| DFD 726편 | 0.811 / 0.692 / 0.063 | 0.872 / 0.755 / 0.008 |
| KoEBA 66편 | 0.709 / 0.587 / 0.000 | 0.916 / 0.891 / 0.000 |

신규 99편 결과는 모델 선택에 여러 번 쓴 **개발·선택 세트**라서 독립 평가 수치로 인용하지 않는다.
**약점**: 표정만 바꾸는 재현(reenactment) 계열에 약함. 얼굴이 안 보이면 `UNKNOWN`.

---

## 7. 반환 JSON

| 필드 | 뜻 |
|---|---|
| `verdict` | `REAL` / `FAKE` / `UNKNOWN`(얼굴 없음) |
| `video_margin` | 영상 점수. **0보다 작으면 FAKE**. 0에서 멀수록 확신이 큼 |
| `fake_score_display` | 화면 표시용 0~1 값. **보정된 확률이 아님** → "가짜일 확률 93%"라고 쓰지 말 것. "가짜 점수" 정도로 표기 |
| `seed_margins` | 모델 3개 각각의 점수 |
| `n_frames_used` / `n_frames_sampled` | 얼굴이 잡힌 프레임 수 / 뽑은 프레임 수(10) |
| `frames[]` | 프레임별 `frame_index`, `time_sec`, `status`(ok/no_face/read_fail), `bbox`, `margin`, `verdict`, 얼굴 이미지(`crop_path` 또는 `crop_jpeg_base64`) |
| `warnings[]` | 얼굴 미검출 등 |
| `timing_ms` | `decode_detect_crop`, `model`, `total` (밀리초) |

---

## 8. 자주 나는 오류

| 증상 | 해결 |
|---|---|
| `conda`를 찾을 수 없음 | Windows는 일반 cmd가 아니라 **Anaconda Prompt**에서 실행 |
| `No module named ...` | `conda activate dfvideo`를 안 했거나 설치 실패. 설치부터 다시 |
| `No module named 'tf_keras'` | `requirements.txt`에 tf-keras가 있으면 그 버전으로 `pip install tf-keras==버전` |
| `Address already in use` / 포트 사용 중 | 서버가 이미 켜져 있음. 기존 창 `Ctrl+C` 또는 `python server.py --port 8001` |
| 영상을 열 수 없음 | mp4(H.264)로 변환해서 다시 |
| 매우 느림 | CPU면 정상. `make_examples.py`의 시간을 연구 담당에게 공유 |
| env_check에서 점수 차이가 조금 넘음 | 판정이 같으면 연구 담당에게 공유 후 진행 |

---

## 9. 하지 말 것

- `predict_api.py`의 처리 순서·숫자(10프레임, 0.15, 224, 임계값 0, 정규화 값) 수정 — 연구 결과와 달라진다
- `fake_score_display`를 확률로 표기
- 신규 99편 결과를 "독립 평가 성능"으로 표기
- 모델 재학습 (연구 담당 영역)

---

## 10. 연구 담당이 지금 하는 것 (내 작업과 무관)

모델 개선 실험(B-2)을 학습 중이다. **기다릴 필요 없다.** 채택되면 `weights/` 폴더만 바뀌고 호출 방법과 JSON 형식은 그대로다.

---

## 11. 파일 목록

| 파일 | 역할 |
|---|---|
| `predict_api.py` | 영상 → JSON 핵심 함수 (수정 금지) |
| `server.py` | 웹 서버 + 테스트 화면 |
| `env_check.py` | 설치 검증 |
| `make_examples.py` | 제출용 실행 예시 자동 생성 |
| `requirements.txt`, `env_reference.json` | 연구 환경과 같은 라이브러리 버전 |
| `weights/` | 모델 가중치 (v4, v6, 얼굴 검출) |
| `samples/`, `golden.json` | 검증용 영상 3편과 기준 결과 |
| `CLAUDE_시작프롬프트.md` | Claude 새 대화에 붙여넣을 프롬프트 |
