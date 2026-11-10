"""CPU-only HTTP/lifecycle regression tests; the detector is deliberately stubbed."""
import asyncio
import importlib.util
import io
import sys
import types
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def detector_api(monkeypatch, tmp_path):
    stub = types.ModuleType('predict_api')
    stub.API_VERSION = 'test'
    stub.Detector = Mock()
    monkeypatch.setitem(sys.modules, 'predict_api', stub)
    api = load_module('detector_test_server', ROOT / 'video_module_v1/server.py')
    monkeypatch.setattr(api.tempfile, 'tempdir', str(tmp_path))
    detector = Mock()
    detector.predict_video.return_value = {'verdict': 'UNKNOWN'}
    api._det = detector
    return api, detector, tmp_path


def test_upload_contract_and_cleanup(detector_api):
    api, detector, directory = detector_api
    response = TestClient(api.app).post('/predict?return_frames=true', files={'file': ('x.mp4', b'video')})
    assert response.status_code == 200
    assert response.json()['video'] == 'x.mp4'
    assert detector.predict_video.call_args.kwargs == {'return_base64': True}
    assert list(directory.iterdir()) == []


@pytest.mark.parametrize('error, status', [(ValueError('/tmp/private'), 400), (RuntimeError('secret'), 500)])
def test_errors_do_not_leak_and_clean_up(detector_api, error, status):
    api, detector, directory = detector_api
    detector.predict_video.side_effect = error
    response = TestClient(api.app).post('/predict', files={'file': ('x.mp4', b'bad')})
    assert response.status_code == status
    assert 'private' not in response.text and 'secret' not in response.text
    assert list(directory.iterdir()) == []


def test_empty_and_missing_upload(detector_api):
    api, detector, directory = detector_api
    client = TestClient(api.app)
    assert client.post('/predict', files={'file': ('x.mp4', b'')}).status_code == 400
    assert client.post('/predict').status_code == 422
    detector.predict_video.assert_not_called()
    assert list(directory.iterdir()) == []


def test_oversize_upload_is_rejected_before_inference(detector_api):
    api, detector, directory = detector_api
    class LargeStream(io.BytesIO):
        def read(self, size=-1):
            return b'x' * (1024 * 1024)
    with pytest.raises(HTTPException) as error:
        api.predict(UploadFile(filename='big.mp4', file=LargeStream()), False)
    assert error.value.status_code == 413
    detector.predict_video.assert_not_called()
    assert list(directory.iterdir()) == []


def test_storage_failure_cleans_partial_file(detector_api):
    api, detector, directory = detector_api
    class BrokenStream(io.BytesIO):
        def read(self, size=-1):
            raise OSError('disk error')
    with pytest.raises(HTTPException) as error:
        api.predict(UploadFile(filename='bad.mp4', file=BrokenStream()), False)
    assert error.value.status_code == 500
    assert list(directory.iterdir()) == []


@pytest.fixture
def generation_api(monkeypatch, tmp_path):
    api = load_module('generation_test_server', ROOT / 'gen_server/server.py')
    monkeypatch.setattr(api, 'STORAGE_DIR', tmp_path)
    return api


def photo():
    return UploadFile(filename='photo.jpg', file=io.BytesIO(b'image'), headers=Headers({'content-type': 'image/jpeg'}))


def test_generation_reserves_slots_and_delete_cancels_worker(generation_api):
    api = generation_api
    api.MAX_CONCURRENT_JOBS = 1
    async def scenario():
        response = await api.create_job(photo(), 'tpl_news')
        job_id = response['job_id']
        assert api.active_processing_count == 1
        busy = await api.create_job(photo(), 'tpl_news')
        assert busy.status_code == 503
        await api.delete_job(job_id)
        await asyncio.sleep(0)
        assert api.active_processing_count == 0
        assert not api.jobs and not api.tasks
        assert not (api.STORAGE_DIR / job_id).exists()
    asyncio.run(scenario())


def test_gpu_configuration_failure_does_not_return_mock_success(generation_api):
    api = generation_api
    api.USE_REAL_GPU = True
    api.FACEFUSION_PATH = str(api.STORAGE_DIR / 'missing.py')
    async def scenario():
        response = await api.create_job(photo(), 'tpl_news')
        job_id = response['job_id']
        await api.tasks[job_id]
        result = await api.get_job_status(job_id)
        assert result['status'] == 'error'
        assert result['simulated'] is False
        assert str(api.STORAGE_DIR) not in result['message']
        await api.delete_job(job_id)
    asyncio.run(scenario())


def test_delete_failure_is_visible_and_retryable(generation_api, monkeypatch):
    api = generation_api
    directory = api.STORAGE_DIR / 'job_test'
    directory.mkdir()
    api.jobs['job_test'] = {'job_dir': str(directory)}
    monkeypatch.setattr(api.shutil, 'rmtree', Mock(side_effect=PermissionError('locked')))
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.delete_job('job_test'))
    assert error.value.status_code == 500
    assert 'job_test' in api.jobs
