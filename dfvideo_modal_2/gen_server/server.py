"""
FaceFusion 딥페이크 영상 생성 백엔드 서버 (FastAPI)
- 대상 인프라: 글로벌호스트 NVIDIA RTX 4090 서버 (11월 연동용)
- 지원 기능:
  1. GET /templates: 시연용 원본 템플릿 목록 반환
  2. POST /jobs: 방문객 얼굴 사진 + 템플릿 ID 작업 생성 (202 Accepted)
  3. GET /jobs/{id}: 작업 상태 및 진행률(0~100) 폴링
  4. GET /jobs/{id}/result: 합성 완료된 MP4 비디오 스트리밍
  5. DELETE /jobs/{id}: 개인정보 보호를 위한 사진 및 결과 파일 즉시 삭제
  6. FaceFusion CLI 헤드리스 실행 연동 및 GPU 미설치 환경 자동 시뮬레이션 폴백
  7. HTTPS / CORS (Vercel 및 로컬 개발 환경 허용)
"""

import os
import sys
import time
import uuid
import shutil
import asyncio
import logging
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# 로깅 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("FaceFusionGenServer")

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
TEMPLATES_DIR = BASE_DIR / "templates"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

# 환경 설정
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))
FACEFUSION_PATH = os.getenv("FACEFUSION_PATH", "facefusion.py")
USE_REAL_GPU = os.getenv("USE_REAL_GPU", "false").lower() in ("true", "1", "yes")

@asynccontextmanager
async def lifespan(app):
    cleanup_task = asyncio.create_task(periodic_cleanup())
    try:
        yield
    finally:
        cleanup_task.cancel()
        running = list(tasks.values())
        for task in running:
            task.cancel()
        await asyncio.gather(cleanup_task, *running, return_exceptions=True)


app = FastAPI(
    lifespan=lifespan,
    title="Fact-Trace AI - FaceFusion Video Synthesis Server",
    description="발표 시연용 방문객 웹캠 얼굴 딥페이크 영상 생성 백엔드 API",
    version="1.0.0",
)

# CORS 설정 (Vercel 및 로컬 개발 도메인 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 실제 운영 시 특정 도메인으로 축소 가능
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 템플릿 정적 파일 서빙
if TEMPLATES_DIR.exists():
    app.mount("/templates-static", StaticFiles(directory=str(TEMPLATES_DIR)), name="templates-static")

# 템플릿 메타데이터 정의 (3~5초 원본 비디오)
PRESET_TEMPLATES = [
    {
        "id": "tpl_news",
        "title": "뉴스 앵커 보도 (권장)",
        "duration_sec": 3.2,
        "thumbnail_url": "/templates/thumb_news.svg",
        "preview_url": "/templates-static/tpl_news.mp4",
        "description": "정면 얼굴과 안정적인 스튜디오 조명",
    },
    {
        "id": "tpl_interview",
        "title": "단독 인터뷰 클립",
        "duration_sec": 4.0,
        "thumbnail_url": "/templates/thumb_interview.svg",
        "preview_url": "/templates-static/tpl_interview.mp4",
        "description": "자연스러운 표정 및 눈 깜빡임 변화",
    },
    {
        "id": "tpl_vlog",
        "title": "일상 브이로그",
        "duration_sec": 4.8,
        "thumbnail_url": "/templates/thumb_vlog.svg",
        "preview_url": "/templates-static/tpl_vlog.mp4",
        "description": "실전 환경 야외 조명 및 핸드헬드 무빙",
    },
    {
        "id": "tpl_speech",
        "title": "강연 및 발표 모션",
        "duration_sec": 3.5,
        "thumbnail_url": "/templates/thumb_speech.svg",
        "preview_url": "/templates-static/tpl_speech.mp4",
        "description": "역동적인 고개 움직임과 입모양 변화",
    },
]

# 인메모리 작업 저장소
# 구조: { job_id: dict }
jobs: Dict[str, Dict[str, Any]] = {}
active_processing_count = 0
tasks: Dict[str, asyncio.Task] = {}


# ─────────────────────────────────────────────────────────────
# 1. 템플릿 목록 조회 (GET /templates)
# ─────────────────────────────────────────────────────────────
@app.get("/templates", summary="합성용 원본 영상 템플릿 목록 조회")
async def get_templates():
    return PRESET_TEMPLATES


# ─────────────────────────────────────────────────────────────
# 2. 딥페이크 합성 작업 생성 (POST /jobs)
# ─────────────────────────────────────────────────────────────
@app.post("/jobs", status_code=status.HTTP_202_ACCEPTED, summary="새 딥페이크 합성 작업 생성")
async def create_job(
    photo: UploadFile = File(..., description="방문객 얼굴 JPEG/PNG 사진"),
    template_id: str = Form(..., description="선택된 템플릿 ID"),
):
    global active_processing_count

    # 1) 파일 포맷 및 크기 유효성 검사
    if not photo.content_type or not (
        photo.content_type.startswith("image/") or (photo.filename or '').lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error_code": "INVALID_IMAGE", "message": "이미지 파일(JPEG, PNG)만 업로드할 수 있습니다."},
        )

    # 2) 템플릿 유효성 검사
    template_found = any(t["id"] == template_id for t in PRESET_TEMPLATES)
    if not template_found:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error_code": "INVALID_TEMPLATE", "message": f"유효하지 않은 템플릿 ID입니다: {template_id}"},
        )

    # 3) 동시 실행 큐 제한 (RTX 4090 과부하 방지)
    if active_processing_count >= MAX_CONCURRENT_JOBS:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error_code": "SERVER_BUSY",
                "message": "현재 GPU 합성 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.",
            },
        )

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    job_dir = STORAGE_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    photo_path = job_dir / "photo.jpg"
    output_path = job_dir / "result.mp4"

    # 사진 파일 디스크 저장
    try:
        content = await photo.read(10 * 1024 * 1024 + 1)
        if not content:
            shutil.rmtree(job_dir, ignore_errors=True)
            return JSONResponse(status_code=400, content={"error_code": "INVALID_IMAGE", "message": "빈 사진 파일입니다."})
        if len(content) > 10 * 1024 * 1024:  # 10MB 초과
            shutil.rmtree(job_dir, ignore_errors=True)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error_code": "FILE_TOO_LARGE", "message": "사진 크기는 10MB 이하여야 합니다."},
            )
        with open(photo_path, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"사진 저장 실패: {e}")
        shutil.rmtree(job_dir, ignore_errors=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error_code": "INTERNAL", "message": "사진 업로드 처리 중 오류가 발생했습니다."},
        )

    # Upload awaits allow other requests to reserve a slot; check again before reservation.
    if active_processing_count >= MAX_CONCURRENT_JOBS:
        shutil.rmtree(job_dir, ignore_errors=True)
        return JSONResponse(status_code=503, content={"error_code": "SERVER_BUSY", "message": "합성 서버가 사용 중입니다. 잠시 후 다시 시도해 주세요."})
    active_processing_count += 1

    # 작업 상태 등록
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "template_id": template_id,
        "created_at": time.time(),
        "job_dir": str(job_dir),
        "photo_path": str(photo_path),
        "output_path": str(output_path),
        "result_url": f"/jobs/{job_id}/result",
        "error_code": None,
        "message": None,
        "simulated": not USE_REAL_GPU,
    }

    # 백그라운드 합성 작업 시작
    task = asyncio.create_task(run_synthesis_task(job_id))
    tasks[job_id] = task
    def release_slot(completed):
        global active_processing_count
        tasks.pop(job_id, None)
        active_processing_count = max(0, active_processing_count - 1)
    task.add_done_callback(release_slot)

    return {"job_id": job_id}


# ─────────────────────────────────────────────────────────────
# 3. 작업 상태 조회 (GET /jobs/{id})
# ─────────────────────────────────────────────────────────────
@app.get("/jobs/{job_id}", summary="합성 작업 상태 및 진행률 조회")
async def get_job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"error_code": "NOT_FOUND", "message": "작업을 찾을 수 없습니다."},
        )

    resp: Dict[str, Any] = {
        "status": job["status"],
        "progress": job["progress"],
        "simulated": job.get("simulated", False),
    }

    if job["status"] == "done":
        resp["result_url"] = job["result_url"]
    elif job["status"] == "error":
        resp["error_code"] = job.get("error_code") or "INTERNAL"
        resp["message"] = job.get("message") or "합성 처리 중 오류가 발생했습니다."

    return resp


# ─────────────────────────────────────────────────────────────
# 4. 결과 MP4 다운로드 / 스트리밍 (GET /jobs/{id}/result)
# ─────────────────────────────────────────────────────────────
@app.get("/jobs/{job_id}/result", summary="완성된 딥페이크 MP4 파일 다운로드")
async def get_job_result(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")

    if job["status"] != "done":
        raise HTTPException(status_code=400, detail="합성 작업이 아직 완료되지 않았습니다.")

    output_path = Path(job["output_path"])
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="결과 비디오 파일이 서버에 존재하지 않습니다.")

    now_str = time.strftime("%Y%m%d_%H%M")
    filename = f"demo_synthetic_{now_str}.mp4"

    return FileResponse(
        path=str(output_path),
        media_type="video/mp4",
        filename=filename,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ─────────────────────────────────────────────────────────────
# 5. 작업 및 서버 데이터 즉시 삭제 (DELETE /jobs/{id})
# ─────────────────────────────────────────────────────────────
@app.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT, summary="개인정보 및 생성 파일 즉시 파기")
async def delete_job(job_id: str):
    job = jobs.get(job_id)
    if job:
        task = tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        job_dir = Path(job.get("job_dir", ""))
        if job_dir.exists():
            try:
                shutil.rmtree(job_dir)
                logger.info(f"[{job_id}] 개인정보 보호: 사진 및 결과 파일 즉시 삭제 완료")
            except Exception as e:
                logger.warning(f"[{job_id}] 파일 삭제 중 오류: {e}")
                raise HTTPException(status_code=500, detail="파일 삭제에 실패했습니다. 다시 시도해 주세요.") from e
        jobs.pop(job_id, None)
    return None


# ─────────────────────────────────────────────────────────────
# 비동기 합성 파이프라인 (FaceFusion CLI 연동 + 시뮬레이션 폴백)
# ─────────────────────────────────────────────────────────────
async def run_synthesis_task(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return
    process = None

    job["status"] = "processing"
    logger.info(f"[{job_id}] 합성 시작 (템플릿: {job['template_id']})")

    photo_path = job["photo_path"]
    template_id = job["template_id"]
    output_path = job["output_path"]

    # 템플릿 비디오 파일 경로
    template_video = TEMPLATES_DIR / f"{template_id}.mp4"

    try:
        # 실제 FaceFusion GPU 실행 조건 확인
        facefusion_bin = Path(FACEFUSION_PATH)
        can_run_facefusion = USE_REAL_GPU and facefusion_bin.exists()
        if USE_REAL_GPU and not can_run_facefusion:
            raise RuntimeError('FaceFusion 실행 파일이 설정되지 않았습니다.')
        if not template_video.exists():
            raise RuntimeError('합성용 원본 영상이 없습니다.')

        if can_run_facefusion:
            # ───────────────────────────────────────────────────────
            # 글로벌호스트 RTX 4090: FaceFusion CLI 헤드리스 실행
            # ───────────────────────────────────────────────────────
            logger.info(f"[{job_id}] FaceFusion CLI 헤드리스 실행 시작")
            cmd = [
                sys.executable,
                str(facefusion_bin),
                "headless-run",
                "-s", photo_path,
                "-t", str(template_video),
                "-o", output_path,
                "--execution-providers", "cuda",
                "--face-swapper-model", "inswapper_128",
                "--face-selector-mode", "one",
                "--output-video-quality", "85",
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # 진행률 모니터링 루프
            for p in range(5, 95, 10):
                await asyncio.sleep(0.8)
                job["progress"] = p

            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=280)

            if process.returncode != 0:
                err_msg = stderr.decode("utf-8", errors="ignore")
                logger.error(f"[{job_id}] FaceFusion 오류 (code {process.returncode}): {err_msg}")

                if "no face detected" in err_msg.lower():
                    job["status"] = "error"
                    job["error_code"] = "FACE_NOT_FOUND"
                    job["message"] = "사진에서 얼굴을 인식하지 못했습니다. 정면을 바라보고 다시 촬영해 주세요."
                    return
                elif "multiple faces" in err_msg.lower():
                    job["status"] = "error"
                    job["error_code"] = "MULTIPLE_FACES"
                    job["message"] = "사진에서 2명 이상의 얼굴이 감지되었습니다. 혼자서 다시 촬영해 주세요."
                    return
                else:
                    job["status"] = "error"
                    job["error_code"] = "INTERNAL"
                    job["message"] = "FaceFusion 합성 엔진 처리 중 오류가 발생했습니다."
                    return

            if not Path(output_path).is_file() or Path(output_path).stat().st_size == 0:
                raise RuntimeError('합성 엔진이 결과 영상을 생성하지 않았습니다.')
            job["progress"] = 100
            job["status"] = "done"
            logger.info(f"[{job_id}] FaceFusion GPU 합성 성공 완료!")

        else:
            # ───────────────────────────────────────────────────────
            # 서버 개발/테스트/11월 GPU 전 폴백: 10초 진행률 시뮬레이션
            # ───────────────────────────────────────────────────────
            logger.info(f"[{job_id}] FaceFusion 모의 합성 시뮬레이션 실행 (약 8초)")

            # 점진적 진행률 업데이트 (0% -> 100%)
            milestones = [
                (15, 1.2),  # 얼굴 랜드마크 분석
                (35, 1.5),  # 인스왑 특징점 정렬
                (60, 2.0),  # 프레임별 블렌딩
                (85, 1.8),  # H.264 인코딩
                (100, 1.0), # 완료
            ]

            for prog, duration in milestones:
                await asyncio.sleep(duration)
                job["progress"] = prog

            # 모의 실행은 준비된 원본만 복사한다. 파일이 사라지면 오류로 처리한다.
            shutil.copyfile(str(template_video), output_path)

            job["status"] = "done"
            logger.info(f"[{job_id}] 모의 합성 완료 (결과 파일 준비됨)")

    except asyncio.TimeoutError:
        job["status"] = "error"
        job["error_code"] = "TIMEOUT"
        job["message"] = "합성 처리 시간이 초과되었습니다. 다시 시도해 주세요."
    except Exception as e:
        logger.error(f"[{job_id}] 예외 발생: {e}")
        job["status"] = "error"
        job["error_code"] = "INTERNAL"
        job["message"] = "합성 서버 내부 처리 중 오류가 발생했습니다."
    finally:
        if process is not None and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.communicate()


# ─────────────────────────────────────────────────────────────
# TTL 주기적 만료 청소 작업 (30분 초과 작업 자동 삭제)
# ─────────────────────────────────────────────────────────────
async def periodic_cleanup():
    while True:
        try:
            await asyncio.sleep(300)  # 5분마다 실행
            now = time.time()
            expired_ids = [
                jid for jid, info in jobs.items()
                if now - info.get("created_at", 0) > 1800  # 30분
            ]
            for jid in expired_ids:
                await delete_job(jid)
            if expired_ids:
                logger.info(f"만료된 임시 작업 {len(expired_ids)}개 자동 정리 완료")
        except Exception as e:
            logger.warning(f"자동 정리 오류: {e}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
