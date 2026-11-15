# -*- coding: utf-8 -*-
"""딥페이크 영상 탐지 서버 — Modal(서버리스 GPU) 배포용

폴더 구조 (이 파일과 패키지 폴더가 같은 위치에 있어야 함)
    작업폴더/
    ├── modal_app.py
    └── video_module_v1/      ← 팀원이 받은 패키지 (predict_api 0.2.1 포함)

명령 (작업폴더에서)
    modal run modal_app.py::check --model v6       # 검증: 디코더 버전 + env_check (v4, v6 각각)
    modal run modal_app.py::examples --model v6    # 처리 시간 측정: 샘플 3편
    modal deploy modal_app.py                      # 배포: 고정 URL 발급
    modal app stop dfvideo                         # 중지: 시연·테스트 끝나면
"""
import modal

PKG = "video_module_v1"     # 패키지 폴더 이름
MODEL = "v6"                # 서비스 모델 (GPU 사용 시 최종 모델 v6)
GPU = "T4"                  # 가장 저렴한 GPU. 처리 시간 확인 후 필요하면 변경

app = modal.App("dfvideo")

# ── 실행 환경 (Linux). Docker 버전과 같은 원칙: 기준 버전 고정, OpenCV는 headless 하나만 ──
image = (
    modal.Image.debian_slim(python_version="3.12")
    .env({"TF_USE_LEGACY_KERAS": "1", "TF_CPP_MIN_LOG_LEVEL": "2", "DF_MODEL": MODEL})
    # requirements.txt의 torch==2.10.0은 Linux에서 GPU(CUDA) 빌드로 설치된다
    .pip_install_from_requirements(f"{PKG}/requirements.txt")
    .run_commands(
        "pip uninstall -y opencv-python opencv-contrib-python opencv-python-headless || true",
        "pip install --no-deps opencv-python-headless==4.13.0.92",
    )
    .add_local_dir(PKG, "/app", copy=True)   # 코드·가중치·샘플을 이미지에 포함
)

FF_SAMPLE = "samples/facefusion_a3Djopy_WaU_S004568_E007299_V1.mp4"


@app.function(image=image, gpu=GPU, timeout=1800)
def check(model: str = MODEL):
    """새 환경 검증. 1) 디코더 버전·FaceFusion 프레임 해시  2) env_check (판정·점수 대조)"""
    import subprocess
    print("=" * 20, "diag_frames", "=" * 20)
    subprocess.run(["python", "diag_frames.py", FF_SAMPLE], cwd="/app")
    print("=" * 20, f"env_check --model {model}", "=" * 20)
    subprocess.run(["python", "env_check.py", "--model", model], cwd="/app")


@app.function(image=image, gpu=GPU, timeout=1800)
def examples(model: str = MODEL):
    """샘플 3편 처리 시간 측정. 구간별 시간(timing_ms)을 함께 출력"""
    import glob, json, subprocess
    subprocess.run(["python", "make_examples.py", "--model", model], cwd="/app")
    print(open(f"/app/examples/{model}/요약.md", encoding="utf-8").read())
    print("\n[구간별 시간 ms]")
    for p in sorted(glob.glob(f"/app/examples/{model}/*.json")):
        r = json.load(open(p, encoding="utf-8"))
        print(f"  {r['video'][:45]:45s} {r['timing_ms']}")


@app.function(
    image=image,
    gpu=GPU,
    timeout=600,             # 요청 1건 최대 10분
    scaledown_window=300,    # 마지막 요청 후 5분 동안 켜둠 → 이후 자동 종료(과금 중지)
    max_containers=1,        # 동시에 최대 1대만 (비용 상한)
)
@modal.asgi_app()
def web():
    """기존 server.py(FastAPI)를 그대로 서비스. 엔드포인트: /, /health, /predict, /docs"""
    import sys
    sys.path.insert(0, "/app")
    import server
    server.det()             # 컨테이너가 켜질 때 모델을 미리 올려 첫 요청 지연을 줄임
    return server.app
