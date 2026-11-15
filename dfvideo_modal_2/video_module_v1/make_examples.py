# -*- coding: utf-8 -*-
"""[팀원용] 교수님 제출용 '실행 예시'를 한 번에 만든다.

실행
    python make_examples.py              # v4
    python make_examples.py --model v6
결과
    examples/<모델>/<영상이름>.json      반환 JSON
    examples/<모델>/<영상이름>/*.jpg     모델이 본 얼굴 프레임 (프레임 반환)
    examples/<모델>/요약.md              판정·점수·처리시간 표 (보고서에 붙이기)
"""
import os
os.environ.setdefault('TF_FORCE_GPU_ALLOW_GROWTH', 'true')
import sys, json, glob, argparse, platform

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from predict_api import Detector

ap = argparse.ArgumentParser()
ap.add_argument('--model', default='v4')
ap.add_argument('--videos', default=os.path.join(HERE, 'samples'))
a = ap.parse_args()

out = os.path.join(HERE, 'examples', a.model)
os.makedirs(out, exist_ok=True)
det = Detector(a.model)
lines = [f'# 실행 예시 — 모델 {a.model} ({det.n_seeds} seed) · {det.device} · '
         f'{platform.system()} · python {platform.python_version()}', '',
         '| 영상 | 판정 | 영상 점수 | 얼굴 검출 | 처리 시간(ms) |', '|---|---|---|---|---|']
for v in sorted(glob.glob(os.path.join(a.videos, '*.mp4'))):
    name = os.path.splitext(os.path.basename(v))[0]
    r = det.predict_video(v, crop_dir=os.path.join(out, name))
    json.dump(r, open(os.path.join(out, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    lines.append(f"| {name} | {r['verdict']} | {r['video_margin']} | {r['n_frames_used']}/{r['n_frames_sampled']} "
                 f"| {r['timing_ms']['total']} |")
    print(lines[-1])
lines += ['', '영상 점수 = 프레임별 (logit_real − logit_fake) 평균, 3 seed 평균. 0보다 작으면 FAKE (임계값 0 고정).',
          '처리 시간 = 프레임 읽기 + 얼굴 검출 + 모델 (첫 호출은 로딩 때문에 더 느릴 수 있음).']
open(os.path.join(out, '요약.md'), 'w', encoding='utf-8').write('\n'.join(lines))
print('\n저장:', out)
