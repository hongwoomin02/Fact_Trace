# -*- coding: utf-8 -*-
"""프레임 디코딩 진단 — 같은 영상에서 같은 프레임이 읽히는지 확인.

연구 담당(Kaggle)과 팀원(로컬) 양쪽에서 같은 영상으로 실행해 출력을 비교한다.

사용
    python diag_frames.py samples/<FaceFusion 영상>.mp4            # 팀원
    import diag_frames as D; D.run('/kaggle/input/.../xxx.mp4')     # Kaggle
출력
    1. 파일 SHA256 (영상 파일 자체가 같은지)
    2. OpenCV·FFmpeg 버전
    3. 샘플 위치 10곳의 프레임 해시: seek 방식(연구 코드) / 처음부터 순서대로 읽는 방식
    4. (패키지 안에서 실행 시) 프레임별 margin과 golden.json 비교
"""
import os, sys, json, hashlib
import numpy as np
import cv2


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def ffmpeg_info():
    for line in cv2.getBuildInformation().splitlines():
        if 'FFMPEG' in line or 'avcodec' in line or 'avformat' in line:
            yield line.strip()


def frame_hashes(path, n=10):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS)
    pos = np.linspace(0, total - 1, n, dtype=int).tolist()
    seek = {}
    for p in pos:                                  # 연구 코드와 같은 방식
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(p))
        ok, fr = cap.read()
        seek[p] = hashlib.md5(fr.tobytes()).hexdigest()[:10] if ok else 'READ_FAIL'
    cap.release()
    cap = cv2.VideoCapture(path)
    seq, i, want = {}, 0, set(pos)                 # 처음부터 순서대로 읽기
    while i <= pos[-1]:
        ok, fr = cap.read()
        if not ok:
            break
        if i in want:
            seq[i] = hashlib.md5(fr.tobytes()).hexdigest()[:10]
        i += 1
    cap.release()
    return total, fps, pos, seek, seq


def run(path):
    print('파일      :', os.path.basename(path))
    print('SHA256    :', sha256(path))
    print('OpenCV    :', cv2.__version__)
    for l in ffmpeg_info():
        print('          ', l)
    total, fps, pos, seek, seq = frame_hashes(path)
    print(f'총 프레임 : {total} · fps {fps:.3f}')
    print(f'\n{"위치":>6} {"seek 해시":>12} {"순차 해시":>12}  일치')
    for p in pos:
        print(f'{p:>6} {seek[p]:>12} {seq.get(p, "-"):>12}  {"O" if seek[p] == seq.get(p) else "★X"}')

    here = os.path.dirname(os.path.abspath(__file__))
    gpath = os.path.join(here, 'golden.json')
    if os.path.exists(gpath) and os.path.exists(os.path.join(here, 'predict_api.py')):
        sys.path.insert(0, here)
        from predict_api import Detector
        g = next((x for x in json.load(open(gpath, encoding='utf-8'))['v4']
                  if x['video'] == os.path.basename(path)), None)
        if g:
            r = Detector('v4').predict_video(path)
            print(f'\n프레임별 margin (v4)   기준 {g["video_margin"]:+.3f} / 현재 {r["video_margin"]:+.3f}')
            for f, gm in zip(r['frames'], g['frame_margins']):
                fm = f['margin']
                d = '' if fm is None or gm is None else f'{fm - gm:+.3f}'
                print(f'  #{f["frame_index"]:>5}  기준 {str(gm):>8}  현재 {str(fm):>8}  차이 {d}')


if __name__ == '__main__':
    run(sys.argv[1])
