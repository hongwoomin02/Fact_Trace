import asyncio
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import server


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "TEMPLATES_DIR", tmp_path / "templates")
    monkeypatch.setattr(server, "STORAGE_DIR", tmp_path / "jobs")
    server.TEMPLATES_DIR.mkdir()
    (server.TEMPLATES_DIR / "01 demo.mp4").write_bytes(b"video fixture")
    (server.TEMPLATES_DIR / "ignore.txt").write_text("ignored")
    server.jobs.clear()
    server.tasks.clear()
    async def gpu(model=server.MODEL):
        pass
    monkeypatch.setattr(server, "check_gpu", gpu)
    with TestClient(server.app) as value:
        yield value


def photo():
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(output, "PNG")
    return ("source.png", output.getvalue(), "image/png")


def test_dynamic_templates_and_preview(client):
    templates = client.get("/templates").json()
    assert [t["id"] for t in templates] == ["01 demo.mp4"]
    assert client.get(templates[0]["preview_url"]).content == b"video fixture"
    (server.TEMPLATES_DIR / "02.mp4").write_bytes(b"second")
    assert len(client.get("/templates").json()) == 2
    assert client.get("/templates-static/missing.mp4").status_code == 404


def test_validation(client):
    assert client.post("/jobs", files={"photo": photo()}, data={"template_id": "01 demo.mp4"}).status_code == 400
    assert client.post("/jobs", files={"photo": photo()}, data={"template_id": "../escape.mp4", "consent": "true"}).status_code == 400
    response = client.post("/jobs", files={"photo": ("x.jpg", b"invalid", "image/jpeg")}, data={"template_id": "01 demo.mp4", "consent": "true"})
    assert response.json()["error_code"] == "INVALID_IMAGE"


@pytest.mark.parametrize("model", ["facefusion", "fsgan"])
def test_real_runner_contract_and_result_deletion(client, monkeypatch, tmp_path, model):
    runner = tmp_path / "runner.py"
    runner.write_text("import sys, pathlib\np=pathlib.Path(sys.argv[sys.argv.index('--output')+1]); p.write_bytes(sys.argv[sys.argv.index('--model')+1].encode())\n")
    monkeypatch.setattr(server, "RUNNER", runner)
    response = client.post("/jobs", files={"photo": photo()}, data={"template_id": "01 demo.mp4", "consent": "true", "model": model})
    assert response.status_code == 202
    jid = response.json()["job_id"]
    import time
    for _ in range(100):
        state = client.get(f"/jobs/{jid}").json()
        if state["status"] in ("done", "error"):
            break
        time.sleep(.02)
    assert state["status"] == "done", state
    assert state["simulated"] is False
    assert state["model"] == model
    assert client.get(state["result_url"]).content == model.encode()
    assert not (server.STORAGE_DIR / jid / "photo.jpg").exists()
    assert client.delete(f"/jobs/{jid}").status_code == 204
    assert not (server.STORAGE_DIR / jid).exists()
    assert client.get(f"/jobs/{jid}").status_code == 404


def test_gpu_failure_does_not_return_template(client, monkeypatch):
    async def unavailable(model=server.MODEL):
        raise RuntimeError("GPU unavailable")
    monkeypatch.setattr(server, "check_gpu", unavailable)
    response = client.post("/jobs", files={"photo": photo()}, data={"template_id": "01 demo.mp4", "consent": "true"})
    jid = response.json()["job_id"]
    import time
    for _ in range(100):
        state = client.get(f"/jobs/{jid}").json()
        if state["status"] == "error":
            break
        time.sleep(.01)
    assert state["status"] == "error"
    assert client.get(f"/jobs/{jid}/result").status_code == 409
    assert not (server.STORAGE_DIR / jid / "photo.jpg").exists()


def test_cancel_running_job_and_release_queue(client, monkeypatch, tmp_path):
    import time
    runner = tmp_path / "slow.py"
    runner.write_text("import time; time.sleep(60)")
    monkeypatch.setattr(server, "RUNNER", runner)
    monkeypatch.setattr(server, "MAX_JOBS", 1)
    response = client.post("/jobs", files={"photo": photo()}, data={"template_id": "01 demo.mp4", "consent": "true"})
    jid = response.json()["job_id"]
    assert client.post("/jobs", files={"photo": photo()}, data={"template_id": "01 demo.mp4", "consent": "true"}).status_code == 503
    for _ in range(100):
        if client.get(f"/jobs/{jid}").json()["status"] == "processing":
            break
        time.sleep(.01)
    assert client.delete(f"/jobs/{jid}").status_code == 204
    assert not server.tasks
    assert not server.app.state.gpu_lock.locked()
    assert not (server.STORAGE_DIR / jid).exists()


def test_orphan_cleanup_preserves_recent_files(client):
    import os
    import time
    expired = server.STORAGE_DIR / "job_old"
    expired.mkdir()
    (expired / "photo.jpg").write_bytes(b"old")
    os.utime(expired, (time.time() - server.TTL - 60,) * 2)
    recent = server.STORAGE_DIR / "job_recent"
    recent.mkdir()
    server.cleanup_orphans()
    assert not expired.exists()
    assert recent.exists()


def test_invalid_model_is_rejected_without_creating_job(client):
    response = client.post("/jobs", files={"photo": photo()}, data={"template_id": "01 demo.mp4", "consent": "true", "model": "arbitrary-command"})
    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_MODEL"
    assert not server.jobs


def test_completed_job_survives_restart_until_expiry(client):
    import time
    directory = server.STORAGE_DIR / "job_preserved"
    directory.mkdir()
    (directory / "result.mp4").write_bytes(b"existing result")
    job = {"status": "done", "progress": 100, "model": "fsgan", "simulated": False,
           "created_at": time.time(), "directory": directory, "result_url": "/jobs/job_preserved/result"}
    server.save_job(job)
    server.restore_jobs()
    assert client.get("/jobs/job_preserved").json()["model"] == "fsgan"
    assert client.get("/jobs/job_preserved/result").content == b"existing result"
    assert client.delete("/jobs/job_preserved").status_code == 204
    assert not directory.exists()
