# -*- coding: utf-8 -*-
"""HTTP 서버 (교수님 요구: 서비스에서 호출 가능 + 실행 예시).

실행 (Windows/Mac/Linux 공통)
    python server.py                 # v4, 포트 8000
    python server.py --model v6      # v6 (GPU 권장)
확인
    브라우저에서 http://localhost:8000        -> 영상 올려보는 테스트 화면
    브라우저에서 http://localhost:8000/docs   -> API 문서 (여기서도 직접 호출 가능)
"""
import os
import shutil
import tempfile

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse

from predict_api import API_VERSION, Detector

MODEL = os.getenv('DF_MODEL', 'v4')
app = FastAPI(title='deepfake-video-detector', version=API_VERSION)
_det = None


def det():
    global _det
    if _det is None:
        _det = Detector(MODEL)
    return _det


@app.get('/health')
def health():
    d = det()
    return {'status': 'ok', 'model': d.name, 'n_seeds': d.n_seeds,
            'device': str(d.device), 'api_version': API_VERSION}


@app.post('/predict')
def predict(file: UploadFile = File(...), return_frames: bool = Query(False)):
    """영상 1편 -> 판정 JSON. return_frames=true면 얼굴 crop을 base64 JPEG로 함께 반환."""
    suffix = os.path.splitext(file.filename or '')[1] or '.mp4'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        shutil.copyfileobj(file.file, f)
        tmp = f.name
    try:
        r = det().predict_video(tmp, return_base64=return_frames)
        r['video'] = file.filename
        return r
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        os.remove(tmp)


PAGE = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>딥페이크 탐지 테스트</title>
<style>body{font-family:sans-serif;max-width:900px;margin:24px auto;padding:0 12px}
.v{font-size:28px;font-weight:bold}.FAKE{color:#c0392b}.REAL{color:#27ae60}.UNKNOWN{color:#888}
.fr{display:inline-block;margin:4px;text-align:center;font-size:12px}.fr img{width:112px;display:block}
pre{background:#f4f4f4;padding:8px;overflow:auto;max-height:300px}</style></head><body>
<h2>딥페이크 영상 탐지 — 테스트 화면</h2>
<input type="file" id="f" accept="video/*"> <button onclick="go()">분석</button> <span id="s"></span>
<div id="out"></div>
<script>
async function go(){
  const f=document.getElementById('f').files[0]; if(!f){alert('영상을 고르세요');return}
  const s=document.getElementById('s'); s.textContent='분석 중... (CPU면 수십 초 걸릴 수 있음)';
  const fd=new FormData(); fd.append('file',f);
  const r=await fetch('/predict?return_frames=true',{method:'POST',body:fd});
  const j=await r.json(); s.textContent='';
  if(!r.ok){document.getElementById('out').innerHTML='<pre>'+JSON.stringify(j,null,2)+'</pre>';return}
  let h=`<p class="v ${j.verdict}">${j.verdict}</p>
  <p>영상 점수(margin) ${j.video_margin} (0보다 작으면 FAKE) · 얼굴 검출 ${j.n_frames_used}/${j.n_frames_sampled}
  · 모델 ${j.model} · ${j.device} · 처리 ${j.timing_ms.total} ms</p>`;
  for(const fr of j.frames){ if(fr.crop_jpeg_base64){
    h+=`<div class="fr"><img src="data:image/jpeg;base64,${fr.crop_jpeg_base64}">
    #${fr.frame_index} ${fr.verdict}<br>${fr.margin}</div>`; delete fr.crop_jpeg_base64;} }
  h+='<h4>JSON</h4><pre>'+JSON.stringify(j,null,2)+'</pre>';
  document.getElementById('out').innerHTML=h;
}
</script></body></html>"""


@app.get('/', response_class=HTMLResponse)
def home():
    return PAGE


if __name__ == '__main__':
    import argparse
    import uvicorn
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=MODEL)
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--host', default='127.0.0.1')
    a = ap.parse_args()
    MODEL = a.model
    print(f'모델 {MODEL} 로딩 중... (처음 한 번, 수 초~수십 초)')
    det()
    print(f'준비 완료 -> 브라우저에서 http://localhost:{a.port} 열기  (종료: Ctrl+C)')
    uvicorn.run(app, host=a.host, port=a.port)
