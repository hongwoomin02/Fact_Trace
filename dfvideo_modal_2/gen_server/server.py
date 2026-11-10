"""GPU synthesis API. Run one Uvicorn worker on the prepared GPU server."""
import asyncio
import io
import json
import logging
import os
import shutil
import signal
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent
TEMPLATES_DIR = Path(os.getenv("GEN_TEMPLATES_DIR", str(ROOT / "video-generation" / "templates"))).resolve()
STORAGE_DIR = Path(os.getenv("GEN_STORAGE_DIR", str(BASE / "storage"))).resolve()
RUNNER = Path(os.getenv("GEN_RUNNER", str(ROOT / "video-generation" / "run_video.py"))).resolve()
SUPPORTED_MODELS = ("facefusion", "fsgan")
MODEL = os.getenv("GEN_MODEL", "facefusion")
if MODEL not in SUPPORTED_MODELS:
    raise ValueError("GEN_MODEL must be facefusion or fsgan")
GPU = os.getenv("GEN_GPU_ID", "0")
TIMEOUT = int(os.getenv("GEN_TIMEOUT_SECONDS", "600"))
TTL = int(os.getenv("GEN_TTL_SECONDS", "1800"))
MAX_JOBS = int(os.getenv("GEN_MAX_JOBS", "4"))
jobs = {}
tasks = {}
logger = logging.getLogger(__name__)
Image.MAX_IMAGE_PIXELS = 20_000_000


def template_files():
    if not TEMPLATES_DIR.is_dir():
        return {}
    return {p.name: p for p in sorted(TEMPLATES_DIR.iterdir())
            if p.is_file() and not p.is_symlink() and p.suffix.lower() == ".mp4" and p.stat().st_size > 0}


def fail(code, message, status=400):
    return JSONResponse({"error_code": code, "message": message}, status_code=status)


async def command(*args):
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), 15)
        if proc.returncode:
            raise RuntimeError(err.decode(errors="replace")[-500:])
        return out.decode().strip()
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


async def check_gpu(model=MODEL):
    if sys.platform != "linux" or model not in SUPPORTED_MODELS or not RUNNER.is_file():
        raise RuntimeError("Run this API on the prepared Linux GPU server; check GEN_MODEL and GEN_RUNNER.")
    home = Path.home()
    if not (home / "miniconda3/envs" / model / "bin/python").is_file():
        raise RuntimeError("Model Conda environment is missing.")
    model_file = home / ("facefusion/facefusion.py" if model == "facefusion" else "fsgan/fsgan/inference/swap.py")
    if not model_file.is_file():
        raise RuntimeError("Model entrypoint is missing.")
    await command("nvidia-smi", "-i", GPU, "--query-gpu=name,memory.total", "--format=csv,noheader")
    busy = await command("nvidia-smi", "-i", GPU, "--query-compute-apps=pid", "--format=csv,noheader,nounits")
    if busy:
        raise RuntimeError("Selected GPU is occupied. Retry when it is free.")


def save_job(job):
    state = {k: v for k, v in job.items() if k not in ("directory", "target")}
    destination = job["directory"] / "state.json"
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(state), encoding="utf-8")
    temporary.replace(destination)


def restore_jobs():
    for directory in STORAGE_DIR.glob("job_*"):
        if not directory.is_dir() or directory.is_symlink():
            continue
        try:
            state = json.loads((directory / "state.json").read_text(encoding="utf-8"))
            if state["status"] not in ("done", "error") or time.time() - state["created_at"] > TTL:
                continue
            if state["status"] == "done" and not (directory / "result.mp4").is_file():
                continue
            state["directory"] = directory
            state["model"] = state.get("model", MODEL)
            if state["status"] == "done":
                state["result_url"] = f"/jobs/{directory.name}/result"
            jobs[directory.name] = state
        except (OSError, ValueError, KeyError, TypeError):
            continue


def cleanup_orphans():
    active = set(jobs)
    for directory in STORAGE_DIR.glob("job_*"):
        if directory.name not in active and directory.is_dir() and not directory.is_symlink() and time.time() - directory.stat().st_mtime > TTL:
            shutil.rmtree(directory)


async def cleanup_loop():
    while True:
        await asyncio.sleep(60)
        try:
            for jid, job in list(jobs.items()):
                if time.time() - job["created_at"] > TTL:
                    await delete_job(jid)
            cleanup_orphans()
        except Exception:
            logger.exception("Temporary file cleanup failed")


@asynccontextmanager
async def lifespan(app):
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    restore_jobs()
    cleanup_orphans()
    app.state.gpu_lock = asyncio.Lock()
    cleanup = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        cleanup.cancel()
        pending = list(tasks.values())
        for task in pending:
            task.cancel()
        await asyncio.gather(cleanup, *pending, return_exceptions=True)


app = FastAPI(title="Fact-Trace GPU Synthesis", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=os.getenv("GEN_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])


@app.get("/health")
async def health():
    try:
        # An active service job is healthy even though the GPU is occupied.
        if not app.state.gpu_lock.locked():
            await check_gpu()
        return {"status": "ok", "model": MODEL, "supported_models": SUPPORTED_MODELS, "gpu_id": GPU, "simulated": False,
                "templates": len(template_files()), "active_jobs": sum(not t.done() for t in tasks.values())}
    except Exception as exc:
        return JSONResponse({"status": "unavailable", "message": str(exc)}, status_code=503)


@app.get("/templates")
async def templates():
    return [{"id": name, "title": Path(name).stem.replace("_", " "),
             "duration_sec": None, "thumbnail_url": "", "preview_url": "/templates-static/" + quote(name),
             "description": "Source video for face synthesis"} for name in template_files()]


@app.get("/templates-static/{name}")
async def preview(name: str):
    path = template_files().get(name)
    if path is None:
        raise HTTPException(404, "Source video not found.")
    return FileResponse(path, media_type="video/mp4")


@app.post("/jobs", status_code=202)
async def create_job(photo: UploadFile = File(...), template_id: str = Form(...), consent: bool = Form(False), model: str = Form(MODEL)):
    try:
        if model not in SUPPORTED_MODELS:
            return fail("INVALID_MODEL", "FaceFusion 또는 FSGAN을 선택해 주세요.")
        if not consent:
            return fail("CONSENT_REQUIRED", "Consent to using your own face and authorized source video is required.")
        target = template_files().get(template_id)
        if target is None:
            return fail("INVALID_TEMPLATE", "Source video not found.")
        if sum(not t.done() for t in tasks.values()) >= MAX_JOBS:
            return fail("SERVER_BUSY", "Synthesis queue is full.", 503)
        data = await photo.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            return fail("FILE_TOO_LARGE", "Image must be 10MB or smaller.", 413)
        try:
            with Image.open(io.BytesIO(data)) as original:
                if original.format not in ("JPEG", "PNG", "WEBP"):
                    raise ValueError("Unsupported image")
                image = ImageOps.exif_transpose(original).convert("RGB")
                image.thumbnail((1920, 1920))
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            return fail("INVALID_IMAGE", "A valid JPEG, PNG or WEBP photo is required.")
        # No await between reserving this slot and registering the task.
        if sum(not t.done() for t in tasks.values()) >= MAX_JOBS:
            return fail("SERVER_BUSY", "Synthesis queue is full.", 503)
        jid = "job_" + uuid.uuid4().hex
        directory = STORAGE_DIR / jid
        directory.mkdir(parents=True)
        try:
            image.save(directory / "photo.jpg", "JPEG", quality=95)
        except Exception:
            shutil.rmtree(directory)
            raise
        jobs[jid] = {"status": "queued", "progress": 0, "created_at": time.time(),
                     "directory": directory, "target": target, "model": model, "simulated": False}
        task = asyncio.create_task(run_job(jid))
        tasks[jid] = task
        task.add_done_callback(lambda _: tasks.pop(jid, None))
        return {"job_id": jid, "model": model}
    finally:
        await photo.close()


async def stop_process(proc):
    if proc.returncode is None:
        try:
            if os.name == "posix":
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()


async def run_job(jid):
    job = jobs[jid]
    directory = job["directory"]
    proc = None
    acquired = False
    try:
        await app.state.gpu_lock.acquire()
        acquired = True
        await check_gpu(job["model"])
        job.update(status="processing", progress=10)
        with (directory / "engine.log").open("wb") as log:
            spawning = asyncio.create_task(asyncio.create_subprocess_exec(
                sys.executable, str(RUNNER), "--model", job["model"],
                "--source", str(directory / "photo.jpg"), "--target", str(job["target"]),
                "--output", str(directory / "result.mp4"),
                stdout=log, stderr=log, start_new_session=(os.name == "posix"),
                env={**os.environ, "GEN_GPU_ID": GPU}))
            try:
                proc = await asyncio.shield(spawning)
            except asyncio.CancelledError:
                # A process may already exist even if cancellation interrupts spawning.
                proc = await spawning
                raise
            await asyncio.wait_for(proc.wait(), TIMEOUT)
        output = directory / "result.mp4"
        if proc.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError("Synthesis engine failed. Check the server job log.")
        job.update(status="done", progress=100, result_url=f"/jobs/{jid}/result")
    except asyncio.CancelledError:
        job.update(status="error", error_code="INTERNAL", message="합성 작업이 중단되었습니다. 다시 시도해 주세요.")
        raise
    except asyncio.TimeoutError:
        job.update(status="error", error_code="TIMEOUT", message="Synthesis exceeded the time limit.")
    except Exception as exc:
        logger.exception("Synthesis failed: %s", jid)
        job.update(status="error", error_code="INTERNAL", message=str(exc))
    finally:
        if proc is not None:
            await stop_process(proc)
        if acquired:
            app.state.gpu_lock.release()
        (directory / "photo.jpg").unlink(missing_ok=True)
        if job["status"] != "done":
            (directory / "result.mp4").unlink(missing_ok=True)
        save_job(job)


@app.get("/jobs/{jid}")
async def job_status(jid: str):
    if jid not in jobs:
        raise HTTPException(404, "Job not found.")
    return {k: v for k, v in jobs[jid].items() if k not in ("directory", "target", "created_at")}


@app.get("/jobs/{jid}/result")
async def result(jid: str):
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "Job not found.")
    if job["status"] != "done":
        raise HTTPException(409, "Synthesis has not completed.")
    return FileResponse(job["directory"] / "result.mp4", media_type="video/mp4",
                        filename="synthetic_demo.mp4", headers={"Cache-Control": "no-store"})


@app.delete("/jobs/{jid}", status_code=204)
async def delete_job(jid: str):
    job = jobs.get(jid)
    if job:
        task = tasks.get(jid)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        shutil.rmtree(job["directory"], ignore_errors=False)
        jobs.pop(jid, None)
