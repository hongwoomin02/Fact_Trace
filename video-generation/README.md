# Fact-Trace AI — 영상 합성 모듈 인수인계 (2026-11-09)

## 1. 무엇이 준비됐나?
- **FaceFusion**: RTX 3090(GPU 0), FaceFusion conda 환경에서 5초 합성 성공, 결과 영상 확인 완료.
- **FSGAN**: RTX 3090(GPU 0), FSGAN conda 환경에서 5초 합성 성공, 결과 영상 확인 완료.
- 실측 실행 시간: FaceFusion **12.356초**, FSGAN **30.997초** (각각 5초·125프레임 입력 영상, 업로드·다운로드 시간 제외).
- 비교는 각 1회 측정, 워밍업·캐시·설정이 달라 **정밀한 모델 벤치마크는 아님**.
- 영상 합성 코드는 서버에 설치되어 있고, 이 압축파일에는 **실행·연동용 래퍼 스크립트**만 포함되어 있습니다.

## 2. 환경과 경로 (확인된 내용)
| 구분 | FaceFusion | FSGAN |
|---|---|---|
| 시스템 | Ubuntu 22.04 GPU 서버 | 같은 서버 |
| GPU | RTX 3090, device 0 | RTX 3090, device 0 |
| conda 환경 | `facefusion` | `fsgan` |
| 실행 코드 | `/home/pukyong/facefusion/facefusion.py` | `/home/pukyong/fsgan/fsgan/inference/swap.py` |
| 입력 테스트 | `/home/pukyong/ff_test/input/testimg.jpeg` | 같은 이미지의 JPG 확장자 사본 |
| 테스트 대상 영상 | `/home/pukyong/ff_test/input/demo_5sec_faceswap.mp4` | 동일 |
| 테스트 출력 | `/home/pukyong/ff_test/output/final_5sec.mp4` | `/home/pukyong/fsgan_test/output/fsgan_source_demo_5sec_faceswap.mp4` |
| 주요 설정 | `hyperswap_1a_256`, CUDA, 8 threads, H.264 veryfast | `--gpus 0 --seg_remove_mouth` |

추가 확인 환경: GPU 서버는 **RTX 3090 24GB × 2**, **RAM 128GB**, Ubuntu 22.04.5 / NVIDIA driver 595.99.02이며, 이 실행은 GPU 0 한 장만 사용합니다. FaceFusion 환경은 Python 3.12 계열, conda FFmpeg 7.0.1과 CUDA 12 계열 실행 라이브러리를 사용합니다. FSGAN 환경은 **Python 3.9.23**, **PyTorch 1.12.1+cu116**, **CUDA 11.6 런타임**이며 `yacs==0.1.8` 설치를 확인했습니다. 해당 서버 드라이버가 보고하는 CUDA 13.2는 PyTorch 실행 런타임 버전과 구분해야 합니다. **두 conda 환경을 합치면 안 됩니다.**

모델 원본 소스: [FaceFusion](https://github.com/facefusion/facefusion) / [FSGAN](https://github.com/YuvalNirkin/fsgan). 모델·가중치의 원본 라이선스 및 이용 조건을 확인한 상태에서 공유·배포해야 합니다.

FSGAN 가중치는 기존 서버 `/home/pukyong/fsgan/weights/`에 설치되어 있으며, 이 압축파일에는 포함하지 않습니다. 가중치 원본 아카이브는 `/home/pukyong/fsgan_weights.tar.gz` (약 2.7GB) 입니다. 기존 서버에 이미 구성된 conda 환경을 전제로 합니다.

## 3. 서버에서 한 번만 설치할 래퍼 파일

팀원이 받은 `FactTraceAI_video_handoff.zip`을 **GPU 서버의 `/home/pukyong/`** 에 올리고 아래처럼 풉니다.

```bash
cd /home/pukyong
unzip -o FactTraceAI_video_handoff.zip
cd /home/pukyong/FactTraceAI_video_handoff
chmod +x scripts/*.sh
```

※ 서버 주소/아이디/비밀번호와 외부 웹 API 주소는 **이 파일에 포함하지 않았습니다**. 서버 접속 권한은 별도로 안전하게 공유해야 합니다.

## 4. 단일 실행 진입점 (백엔드 연동에 권장)

이 패키지의 `run_video.py`는 **서버 로컬에서** FaceFusion/FSGAN 중 하나를 실행하는 CLI 래퍼입니다.

### FaceFusion
```bash
cd /home/pukyong/FactTraceAI_video_handoff
python3 run_video.py \
  --model facefusion \
  --source /home/pukyong/ff_test/input/testimg.jpeg \
  --target /home/pukyong/ff_test/input/demo_5sec_faceswap.mp4 \
  --output /home/pukyong/ff_test/output/facefusion_handoff.mp4 \
  --log /home/pukyong/ff_test/output/facefusion_handoff.log
```

### FSGAN
```bash
cd /home/pukyong/FactTraceAI_video_handoff
python3 run_video.py \
  --model fsgan \
  --source /home/pukyong/ff_test/input/testimg.jpeg \
  --target /home/pukyong/ff_test/input/demo_5sec_faceswap.mp4 \
  --output /home/pukyong/fsgan_test/output/fsgan_handoff.mp4 \
  --log /home/pukyong/fsgan_test/output/fsgan_handoff.log
```

각 명령의 성공 시 표준출력에 다음 필드의 JSON 요약을 반환하도록 작성했습니다.
`status`, `model`, `output_path`, `size_bytes`, `sha256`, `processing_seconds`, `timestamp_utc`, `measurement_scope`.

**주의:** `run_video.py`와 새 래퍼 스크립트 자체는 본 문서 작성 시점에 실제 서버에서 검증하지 못했습니다. 위 두 모델의 **직접 실행 명령은 실제 성공 확인 완료**했습니다. 팀 배포 전 위 명령으로 1회 검증이 필요합니다.

## 5. 기존 서버에서 직접 실행한 FaceFusion 명령

```bash
source ~/miniconda3/etc/profile.d/conda.sh
conda activate facefusion
export LD_LIBRARY_PATH="$CONDA_PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cd ~/facefusion

python facefusion.py headless-run \
  --source-paths ~/ff_test/input/testimg.jpeg \
  --target-path ~/ff_test/input/demo_5sec_faceswap.mp4 \
  --output-path ~/ff_test/output/final_5sec.mp4 \
  --processors face_swapper \
  --face-selector-mode one \
  --face-swapper-model hyperswap_1a_256 \
  --execution-providers cuda \
  --execution-device-ids 0 \
  --execution-thread-count 8 \
  --output-video-encoder libx264 \
  --output-video-preset veryfast \
  --output-video-quality 80 \
  --log-level info
```

FaceFusion `facefusion` conda 환경에서 CUDA 라이브러리 경로와 conda FFmpeg가 설정되어 있어야 합니다.

## 6. 기존 서버에서 직접 실행한 FSGAN 명령

```bash
source ~/miniconda3/etc/profile.d/conda.sh
conda activate fsgan
cd ~/fsgan
# 주의: .jpeg 입력은 전처리 캐시 생성에 실패한 적이 있어 .jpg 확장자를 사용했습니다.
cp ~/ff_test/input/testimg.jpeg ~/ff_test/input/fsgan_source.jpg

python fsgan/inference/swap.py \
  ~/ff_test/input/fsgan_source.jpg \
  -t ~/ff_test/input/demo_5sec_faceswap.mp4 \
  -o ~/fsgan_test/output \
  --gpus 0 \
  --seg_remove_mouth
```

기존 실행의 결과 파일: `~/fsgan_test/output/fsgan_source_demo_5sec_faceswap.mp4`.
FSGAN은 단순히 이미지 파일의 확장자를 `.jpg`로 복사했을 때 성공했습니다. `-v 1` 등 상세 영상 출력을 켜면 다중 패널 디버그 영상이 나올 수 있어 데모에서는 사용하지 않습니다.

## 7. 웹 백엔드 연결을 위해 남은 작업

1. 이용자가 동의한 사진/영상만 받도록 업로드 검증 (파일 형식·용량·길이 제한, 서버 저장 경로).
2. 업로드 파일을 GPU 서버에 전달하고, 이 CLI를 백엔드에서 비동기 작업으로 호출.
3. 결과 MP4 전달/다운로드 URL 생성 및 유효기간·접근 제어.
4. 동일 조건의 여러 영상으로 모델별 반복 시간 측정. **업로드/합성/다운로드 각 단계 시간**을 따로 기록할 것.
5. 합성 완료 뒤 원본·결과·중간 캐시 자동 삭제 정책 검토. 작업 동시 실행 시 GPU 및 저장 공간 점검.
6. 실제 FastAPI/HTTP API/프론트 연결은 **아직 구축·검증되지 않았음**. 이 ZIP은 바로 인터넷에 노출 가능한 API 서버 패키지가 아님.

프로젝트에서는 **탐지 평가용·동의 받은 데이터**를 사용하세요. 다른 사람의 사진·영상을 동의 없이 합성하거나 실제 영상으로 오인시키는 용도로 사용하면 안 됩니다.

## 8. 간단한 서버 내부 백엔드 호출 예시

```python
import json
import subprocess

proc = subprocess.run([
    "python3", "/home/pukyong/FactTraceAI_video_handoff/run_video.py",
    "--model", "facefusion",  # 또는 "fsgan"
    "--source", "/home/pukyong/ff_test/input/testimg.jpeg",
    "--target", "/home/pukyong/ff_test/input/demo_5sec_faceswap.mp4",
    "--output", "/home/pukyong/ff_test/output/backend_result.mp4",
], capture_output=True, text=True, check=True)
result = json.loads(proc.stdout)
print(result["output_path"], result["processing_seconds"])
```

이 코드는 백엔드와 동일한 GPU 서버에서 실행하는 예시입니다. 별도 서버/Modal에서 호출하려면 별도의 인증된 원격 실행·파일 전송 계층이 필요합니다. 이용자가 지정한 임의의 경로를 그대로 실행에 전달하지 말고 서버가 생성한 안전한 경로만 사용하세요.
