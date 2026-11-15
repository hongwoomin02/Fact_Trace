# -*- coding: utf-8 -*-
"""[팀원용] 설치 후 가장 먼저 실행. 버전 대조 + 샘플 영상 결과가 연구 담당 결과와 같은지 확인.

실행
    python env_check.py              # v4
    python env_check.py --model v6   # v6 (패키지에 들어 있을 때)
마지막 줄에 '★ 최종: PASS'가 떠야 다음 단계로 진행한다.
"""
import os
os.environ.setdefault('TF_FORCE_GPU_ALLOW_GROWTH', 'true')
import sys, json, argparse, platform
from importlib.metadata import version, PackageNotFoundError

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 0.10          # 영상 margin 허용 차이 (CPU/GPU 연산 차이 흡수용). 판정(REAL/FAKE)은 반드시 같아야 함


def check_versions():
    ref = json.load(open(os.path.join(HERE, 'env_reference.json'), encoding='utf-8'))
    bad = 0
    mine_py, ref_py = platform.python_version(), ref['python']
    ok = mine_py.rsplit('.', 1)[0] == ref_py.rsplit('.', 1)[0]
    print(f"{'python':22s} 기준 {ref_py:14s} 현재 {mine_py:14s} {'OK' if ok else '★ 다름'}")
    bad += not ok
    pk = dict(ref['packages'])
    if ref.get('opencv_dist'):
        pk['opencv-python-headless'] = ref['opencv_dist'][1]
    for p, v in pk.items():
        try:
            m = version(p)
        except PackageNotFoundError:
            m = None
        if m is None and p == 'opencv-python-headless':        # 다른 배포판 이름으로 설치된 경우
            for alt in ('opencv-python', 'opencv-contrib-python'):
                try:
                    m = version(alt); break
                except PackageNotFoundError:
                    pass
        ok = m is not None and m.split('+')[0] == v.split('+')[0]
        print(f"{p:22s} 기준 {v:14s} 현재 {str(m):14s} {'OK' if ok else '★ 다름/없음'}")
        bad += not ok
    return bad


def check_gpu():
    import torch
    print(f'\ntorch CUDA 사용 가능: {torch.cuda.is_available()}'
          + (f' ({torch.cuda.get_device_name(0)})' if torch.cuda.is_available() else ''))
    try:
        import tensorflow as tf
        print(f'tensorflow GPU: {tf.config.list_physical_devices("GPU")}')
    except Exception as e:
        print('★ tensorflow import 실패:', e)


def check_golden(model):
    sys.path.insert(0, HERE)
    from predict_api import Detector
    gold = json.load(open(os.path.join(HERE, 'golden.json'), encoding='utf-8'))
    if model not in gold:
        print(f'★ golden.json에 {model} 없음 (패키지에 포함 안 됨)'); return False
    d = Detector(model)
    print(f'\n[{model}] device={d.device} seeds={d.n_seeds}')
    all_ok = True
    for g in gold[model]:
        r = d.predict_video(os.path.join(HERE, 'samples', g['video']))
        same_frames = [f['frame_index'] for f in r['frames']] == g['frame_indices']
        same_used = r['n_frames_used'] == g['n_frames_used']
        same_verdict = r['verdict'] == g['verdict']
        diff = (abs(r['video_margin'] - g['video_margin'])
                if r['video_margin'] is not None and g['video_margin'] is not None else float('inf'))
        ok = same_frames and same_used and same_verdict and diff <= TOL
        all_ok &= ok
        fm = lambda v: 'None' if v is None else f'{v:+.3f}'
        print(f"  {g['video'][:40]:40s} 기준 {g['verdict']} {fm(g['video_margin'])} | "
              f"현재 {r['verdict']} {fm(r['video_margin'])} | "
              f"차이 {diff:.3f} 프레임위치 {'OK' if same_frames else '★'} 얼굴수 {'OK' if same_used else '★'} "
              f"{r['timing_ms']['total']}ms  {'OK' if ok else '★ FAIL'}")
    return all_ok


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='v4')
    a = ap.parse_args()
    print('=' * 20, '1. 버전 대조', '=' * 20)
    n_bad = check_versions()
    print('=' * 20, '2. GPU', '=' * 20)
    check_gpu()
    print('=' * 20, '3. 샘플 결과 대조', '=' * 20)
    ok = check_golden(a.model)
    print('\n' + '=' * 60)
    if ok:
        print('★ 최종: PASS' + (f'  (버전 다른 항목 {n_bad}개 — 결과는 일치하므로 진행 가능, 연구 담당에게 공유)' if n_bad else ''))
    else:
        print('★ 최종: FAIL — 이 출력 전체를 연구 담당에게 보낼 것. 서버 작업 진행 금지')
