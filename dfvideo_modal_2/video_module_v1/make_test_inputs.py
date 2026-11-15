# -*- coding: utf-8 -*-
"""오류 흐름 테스트용 입력 파일 3종을 만든다 (교수님 피드백: UNKNOWN·손상 영상·시간 초과).

실행 (video_module_v1이 있는 작업 폴더에서, 가상환경 dfvideo 활성화 후)
    python make_test_inputs.py
    python make_test_inputs.py --sample video_module_v1/samples/a3Djopy_WaU_S004568_E007299_V1.mp4

만들어지는 파일 (test_inputs/ 폴더)
    no_face.mp4     얼굴이 없는 3초 영상 (색 그라데이션)      → 기대(미검증): HTTP 200, verdict=UNKNOWN
    not_video.mp4   영상이 아닌 텍스트 파일(이름만 .mp4)      → 기대(미검증): HTTP 400
    truncated.mp4   샘플 영상을 앞부분 일부만 잘라낸 파일      → UNKNOWN 또는 400 (어느 쪽인지 확인)
※ 기대값은 코드를 읽고 한 예상이다. 실제 응답을 그대로 기록하고, 예상과 달라도 고치지 말고 기록한다.
"""
import os, argparse
import numpy as np
import cv2

ap = argparse.ArgumentParser()
ap.add_argument('--sample', default=None, help='잘린 영상을 만들 원본 mp4 (없으면 truncated 생략)')
ap.add_argument('--keep', type=float, default=0.3, help='원본의 앞 몇 %%를 남길지 (기본 0.3)')
a = ap.parse_args()

OUT = 'test_inputs'
os.makedirs(OUT, exist_ok=True)

# 1) 얼굴 없는 영상: 640x480, 30fps, 3초, 움직이는 색 그라데이션
p = os.path.join(OUT, 'no_face.mp4')
vw = cv2.VideoWriter(p, cv2.VideoWriter_fourcc(*'mp4v'), 30, (640, 480))
assert vw.isOpened(), '★ VideoWriter 열기 실패 — opencv에 mp4 쓰기 지원이 없는 환경일 수 있음. 휴대폰으로 풍경 영상을 찍어 no_face.mp4로 저장해도 됨'
xx = np.tile(np.linspace(0, 255, 640, dtype=np.uint8), (480, 1))
for i in range(90):
    img = np.stack([np.roll(xx, i * 4, axis=1), np.roll(xx, -i * 3, axis=1),
                    np.full((480, 640), (i * 2) % 255, np.uint8)], axis=2)
    vw.write(img)
vw.release()
print('만듦:', p, os.path.getsize(p), 'bytes')

# 2) 영상이 아닌 파일
p = os.path.join(OUT, 'not_video.mp4')
open(p, 'w', encoding='utf-8').write('이 파일은 영상이 아니라 텍스트입니다.\n' * 20)
print('만듦:', p, os.path.getsize(p), 'bytes')

# 3) 잘린 영상
if a.sample:
    data = open(a.sample, 'rb').read()
    n = max(1024, int(len(data) * a.keep))
    p = os.path.join(OUT, 'truncated.mp4')
    open(p, 'wb').write(data[:n])
    print(f'만듦: {p} (원본 {len(data)} bytes 중 앞 {n} bytes, {a.keep*100:.0f}%)')
else:
    print('--sample을 주지 않아 truncated.mp4는 만들지 않음')
