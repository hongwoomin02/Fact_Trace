# -*- coding: utf-8 -*-
"""처리 시간 재측정 (교수님 피드백: 같은 영상으로 기동 직후 / 연속 요청을 소수 반복,
브라우저(클라이언트) 시간과 서버 내부 시간 분리, /health만으로 준비되는지 확인)

설치:  pip install requests
URL은 공개 주소이므로 코드·저장소·보고서 본문에 적지 않는다. 명령줄 인자로만 준다.

사용 (모두 같은 영상 1편으로)
  1) 연속 요청 (이미 켜져 있는 상태에서 N회)
       python measure_time.py --url https://<배포주소> --video 영상.mp4 --mode warm --n 5
  2) 기동 직후 첫 요청 (컨테이너가 꺼질 때까지 기다린 뒤 /predict만 호출, N회 반복)
       python measure_time.py --url ... --video ... --mode cold --n 3
  3) /health로 깨운 직후 첫 요청 (/health만으로 준비가 끝나는지 확인)
       python measure_time.py --url ... --video ... --mode health-cold --n 3
  cold / health-cold 는 반복 사이에 --wait초(기본 330 = scaledown_window 300초 + 여유) 쉰다.
  쉬는 동안 Modal 대시보드에서 컨테이너가 0개가 되었는지 확인하면 더 확실하다.

결과: results/<시각>_<모드>.csv  (한 줄 = 요청 1회) + 화면에 최소·중앙값·최대 요약
"""
import os, sys, csv, time, json, argparse, statistics
from datetime import datetime
import requests

ap = argparse.ArgumentParser()
ap.add_argument('--url', required=True)
ap.add_argument('--video', required=True)
ap.add_argument('--mode', choices=['warm', 'cold', 'health-cold'], required=True)
ap.add_argument('--n', type=int, default=3)
ap.add_argument('--wait', type=int, default=330, help='cold 계열에서 요청 사이에 쉬는 초')
ap.add_argument('--frames', choices=['true', 'false'], default='true',
                help='return_frames. 브라우저 테스트 화면과 같게 true가 기본')
ap.add_argument('--timeout', type=int, default=300)
a = ap.parse_args()

base = a.url.rstrip('/')
os.makedirs('results', exist_ok=True)
out = f'results/{datetime.now():%Y%m%d_%H%M%S}_{a.mode}.csv'
cols = ['run', 'mode', 'video', 'return_frames', 'health_sec', 'client_total_sec', 'http', 'verdict',
        'video_margin', 'srv_decode_detect_crop_ms', 'srv_model_ms', 'srv_total_ms', 'resp_bytes', 'note']


def one(i):
    row = {'run': i, 'mode': a.mode, 'video': os.path.basename(a.video), 'return_frames': a.frames}
    if a.mode == 'health-cold':
        t = time.perf_counter()
        r = requests.get(base + '/health', timeout=a.timeout)
        row['health_sec'] = round(time.perf_counter() - t, 3)
        row['note'] = f'health {r.status_code}'
    t0 = time.perf_counter()               # 업로드 시작 ~ 응답 수신 완료 (화면 표시 시간은 포함하지 않음)
    with open(a.video, 'rb') as f:
        try:
            r = requests.post(f'{base}/predict?return_frames={a.frames}',
                              files={'file': (os.path.basename(a.video), f, 'video/mp4')}, timeout=a.timeout)
        except requests.exceptions.RequestException as e:
            row.update(client_total_sec=round(time.perf_counter() - t0, 3), http='ERR', note=f'{type(e).__name__}: {e}'[:120])
            return row
    row['client_total_sec'] = round(time.perf_counter() - t0, 3)
    row['http'] = r.status_code
    row['resp_bytes'] = len(r.content)
    try:
        j = r.json()
        tm = j.get('timing_ms', {})
        row.update(verdict=j.get('verdict'), video_margin=j.get('video_margin'),
                   srv_decode_detect_crop_ms=tm.get('decode_detect_crop'), srv_model_ms=tm.get('model'),
                   srv_total_ms=tm.get('total'))
    except Exception:
        row['note'] = (row.get('note', '') + ' JSON 아님: ' + r.text[:80]).strip()
    return row


rows = []
for i in range(1, a.n + 1):
    if a.mode != 'warm' and i > 1:
        print(f'  … {a.wait}초 대기 (컨테이너가 꺼지길 기다림)', flush=True)
        time.sleep(a.wait)
    if a.mode == 'warm' and i == 1:
        print('  (warm 모드: 첫 요청은 컨테이너가 이미 켜져 있어야 함. 켜져 있지 않다면 1회차는 제외하고 해석)')
    r = one(i)
    rows.append(r)
    print(f"[{i}/{a.n}] http={r.get('http')} client={r.get('client_total_sec')}s "
          f"server_total={r.get('srv_total_ms')}ms (decode_detect_crop={r.get('srv_decode_detect_crop_ms')}, "
          f"model={r.get('srv_model_ms')}) health={r.get('health_sec')}", flush=True)
    with open(out, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)

ok = [r for r in rows if r.get('http') == 200]
print(f'\n저장: {out}   (성공 {len(ok)}/{len(rows)})')
for key, label in (('client_total_sec', '클라이언트 총 시간(s)'), ('srv_total_ms', '서버 total(ms)'),
                   ('srv_decode_detect_crop_ms', '서버 decode_detect_crop(ms)'), ('srv_model_ms', '서버 model(ms)')):
    v = [r[key] for r in ok if r.get(key) is not None]
    if v:
        print(f'  {label:30s} n={len(v)} 최소 {min(v)} · 중앙값 {statistics.median(v)} · 최대 {max(v)}')
print('※ n이 작아서 대표값이 아니라 이 조건에서 관측한 값이다. 보고서에는 n과 조건을 함께 적는다.')
