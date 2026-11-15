# -*- coding: utf-8 -*-
"""딥페이크 영상 탐지 모듈 (api 0.2)

연구 추론 파이프라인(연구 인계문서 v6, 2절)과 같은 처리를 함수 하나로 묶은 것이다.
  1. 영상당 10프레임 균등 샘플링  np.linspace(0, total-1, 10)
  2. RetinaFace(threshold 0.5) -> 가장 큰 얼굴 1개
  3. bbox를 각 변 15%씩 확장 -> 224x224 RGB uint8
  4. ToTensor + Normalize (v4=ImageNet, v6=CLIP)
  5. 프레임 margin = logit_real - logit_fake, 영상 점수 = 프레임 평균
  6. 3 seed 평균, 임계값 0  (margin < 0 -> FAKE)

★ 이 파일은 연구 결과와 일치하도록 검증된 상태다(build_package.py).
  수정이 필요하면 연구 담당에게 먼저 알릴 것.

사용
    from predict_api import Detector
    det = Detector('v4')                       # 또는 'v6' (GPU 권장)
    result = det.predict_video('a.mp4', crop_dir='out/a')

CLI
    python predict_api.py a.mp4 --model v4 --out result.json --crop_dir out/a
"""
import os
os.environ.setdefault('TF_FORCE_GPU_ALLOW_GROWTH', 'true')   # ★ TF가 GPU 전량 점유하는 것 방지 (tensorflow import 전)
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')

import io, json, time, shutil, base64, threading
import numpy as np
import cv2
from PIL import Image
import torch

API_VERSION = '0.2'
HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(HERE, 'weights')

N_FRAMES, DET_THRESHOLD, MARGIN, IMG, THRESHOLD = 10, 0.5, 0.15, 224, 0.0
NORMS = {
    'imagenet': ([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    'clip': ([0.48145466, 0.4578275, 0.40821073], [0.26862954, 0.26130258, 0.27577711]),
}
V4_ARCH = 'convnextv2_tiny.fcmae_ft_in22k_in1k'


# ───────────────────────── 1~3. 프레임 샘플링·얼굴 검출·crop ─────────────────────────
# ★ 연구 코드 eval_v4_vs_v5._extract_one / h264ctl._extract_one 과 동일하게 옮긴 것.
#   RetinaFace에는 RGB를 넣고, 여백은 int((x2-x1)*0.15), 리사이즈는 torchvision Resize.
_RF = None


def _rf():
    global _RF
    if _RF is None:
        # 오프라인 서버 대비: 패키지에 든 retinaface.h5를 라이브러리 기본 위치로 복사
        src = os.path.join(WEIGHTS, 'retinaface.h5')
        home = os.getenv('DEEPFACE_HOME', os.path.expanduser('~'))
        dst = os.path.join(home, '.deepface', 'weights', 'retinaface.h5')
        if os.path.exists(src) and not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy(src, dst)
        from retinaface import RetinaFace
        _RF = RetinaFace
    return _RF


def extract_faces(video_path):
    """영상 -> 프레임별 기록 + 얼굴 crop 목록.

    반환: rows(샘플 10개 각각의 상태), crops(얼굴 검출된 프레임만, uint8 224x224x3 RGB), fps, total
    """
    from torchvision import transforms
    rs = transforms.Resize((IMG, IMG))
    RF = _rf()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f'영상을 열 수 없음: {video_path}')
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if total <= 0:
        cap.release()
        raise ValueError(f'프레임 수를 읽을 수 없음: {video_path}')
    idxs = np.linspace(0, total - 1, N_FRAMES, dtype=int)

    rows, crops = [], []
    for i in idxs:
        row = {'frame_index': int(i), 'time_sec': round(int(i) / fps, 3) if fps else None,
               'status': 'no_face', 'face_detected': False, 'bbox': None,
               'margin': None, 'verdict': None}
        rows.append(row)
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, frame = cap.read()
        if not ok:
            row['status'] = 'read_fail'
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        faces = RF.detect_faces(rgb, threshold=DET_THRESHOLD)
        if not isinstance(faces, dict) or not faces:
            continue
        best = max(faces.values(),
                   key=lambda f: (f['facial_area'][2] - f['facial_area'][0]) *
                                 (f['facial_area'][3] - f['facial_area'][1]))
        x1, y1, x2, y2 = best['facial_area']
        h, w = rgb.shape[:2]
        mw, mh = int((x2 - x1) * MARGIN), int((y2 - y1) * MARGIN)
        X1, Y1, X2, Y2 = max(0, x1 - mw), max(0, y1 - mh), min(w, x2 + mw), min(h, y2 + mh)
        c = rgb[Y1:Y2, X1:X2]
        if c.size == 0:
            continue
        crops.append(np.asarray(rs(Image.fromarray(c)), dtype=np.uint8))
        row.update(status='ok', face_detected=True, bbox=[int(X1), int(Y1), int(X2), int(Y2)])
    cap.release()
    return rows, crops, fps, total


# ───────────────────────── 4~5. 모델 ─────────────────────────
def _load_sd(path):
    ck = torch.load(path, map_location='cpu', weights_only=False)
    if isinstance(ck, dict):
        for k in ('model', 'model_state_dict', 'state_dict'):
            if isinstance(ck.get(k), dict):
                ck = ck[k]
                break
    return {(k[7:] if k.startswith('module.') else k): v for k, v in ck.items()}


def build_v4(sd=None):
    import timm
    m = timm.create_model(V4_ARCH, pretrained=False, num_classes=2)
    if sd is not None:
        m.load_state_dict(sd, strict=True)
    return m


class CLIPLN(torch.nn.Module):
    """v6 구조. 설정값을 코드에 고정해 인터넷 없이 생성한다. 출력 열0=Fake, 열1=Real."""
    def __init__(self):
        super().__init__()
        from transformers import CLIPVisionConfig, CLIPVisionModel
        cfg = CLIPVisionConfig(hidden_size=1024, intermediate_size=4096, num_hidden_layers=24,
                               num_attention_heads=16, image_size=224, patch_size=14,
                               hidden_act='quick_gelu', layer_norm_eps=1e-5, projection_dim=768)
        self.backbone = CLIPVisionModel(cfg)
        self.head = torch.nn.Linear(1024, 2)

    def forward(self, x):
        return self.head(self.backbone(pixel_values=x).pooler_output)


def load_clip(m, sd, partial=False):
    """transformers 버전에 따라 position_ids 버퍼 유무가 달라서 그 키만 무시한다."""
    sd = {k: v for k, v in sd.items() if not k.endswith('position_ids')}
    r = m.load_state_dict(sd, strict=False)
    missing = [k for k in r.missing_keys if not k.endswith('position_ids')]
    if r.unexpected_keys or (missing and not partial):
        raise RuntimeError(f'v6 가중치 불일치: missing {missing[:5]} unexpected {r.unexpected_keys[:5]}')


class Detector:
    def __init__(self, model='v4', device=None):
        man = json.load(open(os.path.join(WEIGHTS, 'manifest.json'), encoding='utf-8'))
        if model not in man:
            raise ValueError(f'weights에 {model} 없음. 가능한 값: {list(man)}')
        spec = man[model]
        self.name = model
        self.device = torch.device(device or ('cuda' if torch.cuda.is_available() else 'cpu'))
        mean, std = NORMS[spec['norm']]
        self.mean = torch.tensor(mean).view(1, 3, 1, 1).to(self.device)
        self.std = torch.tensor(std).view(1, 3, 1, 1).to(self.device)
        self._lock = threading.Lock()          # v6은 seed마다 파라미터를 바꿔 끼우므로 동시 호출 방지
        if spec['type'] == 'timm_v4':
            self.models = [build_v4(_load_sd(os.path.join(WEIGHTS, f))).to(self.device).eval()
                           for f in spec['files']]
            self.deltas = None
        elif spec['type'] == 'clip_ln':
            m = CLIPLN()
            load_clip(m, _load_sd(os.path.join(WEIGHTS, spec['base'])))
            self.models = [m.to(self.device).eval()]
            self.deltas = [torch.load(os.path.join(WEIGHTS, d), map_location=self.device)
                           for d in spec['deltas']]
        else:
            raise ValueError(spec['type'])
        self.n_seeds = len(self.deltas) if self.deltas else len(self.models)

    @torch.no_grad()
    def margins(self, crops):
        """crops: uint8 (n,224,224,3) RGB -> (seed, n) margin = logit_real - logit_fake."""
        x = torch.from_numpy(np.ascontiguousarray(crops)).to(self.device)
        x = (x.permute(0, 3, 1, 2).float().div(255) - self.mean) / self.std
        out = []
        if self.deltas is None:
            for m in self.models:
                lg = m(x).float()
                out.append(lg[:, 1] - lg[:, 0])
        else:
            m = self.models[0]
            for d in self.deltas:
                load_clip(m, d, partial=True)
                lg = m(x).float()
                out.append(lg[:, 1] - lg[:, 0])
        return torch.stack(out).cpu().numpy()

    def predict_video(self, path, crop_dir=None, return_base64=False):
        with self._lock:
            return self._predict(path, crop_dir, return_base64)

    def _predict(self, path, crop_dir, return_base64):
        warnings, T0 = [], time.perf_counter()
        rows, crops, fps, total = extract_faces(path)
        T2 = time.perf_counter()
        warnings += [f"프레임 {r['frame_index']} 읽기 실패" for r in rows if r['status'] == 'read_fail']

        res = {'api_version': API_VERSION, 'model': self.name, 'n_seeds': self.n_seeds,
               'device': str(self.device), 'video': os.path.basename(path),
               'n_frames_total': total, 'fps': fps, 'n_frames_sampled': len(rows),
               'n_frames_used': len(crops), 'threshold': THRESHOLD}

        if not crops:
            warnings.append('얼굴이 검출된 프레임이 없음 — 판정 불가')
            res.update(verdict='UNKNOWN', video_margin=None, seed_margins=None, fake_score_display=None)
        else:
            M = self.margins(np.stack(crops))
            fm, vm = M.mean(0), float(M.mean(1).mean())
            j = 0
            for row in rows:
                if not row['face_detected']:
                    continue
                row['margin'] = round(float(fm[j]), 4)
                row['verdict'] = 'FAKE' if fm[j] < THRESHOLD else 'REAL'
                if crop_dir:
                    os.makedirs(crop_dir, exist_ok=True)
                    p = os.path.join(crop_dir, f'frame_{row["frame_index"]:06d}.jpg')
                    Image.fromarray(crops[j]).save(p, quality=95)
                    row['crop_path'] = p
                if return_base64:
                    buf = io.BytesIO()
                    Image.fromarray(crops[j]).save(buf, format='JPEG', quality=90)
                    row['crop_jpeg_base64'] = base64.b64encode(buf.getvalue()).decode()
                j += 1
            if len(crops) < N_FRAMES // 2:
                warnings.append('얼굴 검출 프레임이 절반 미만 — 결과 신뢰도 낮음')
            res.update(verdict='FAKE' if vm < THRESHOLD else 'REAL',
                       video_margin=round(vm, 4),
                       seed_margins=[round(float(v), 4) for v in M.mean(1)],
                       fake_score_display=round(float(1 / (1 + np.exp(vm))), 4))
        T3 = time.perf_counter()
        res['frames'] = rows
        res['warnings'] = warnings
        res['timing_ms'] = {'decode_detect_crop': round((T2 - T0) * 1e3),
                            'model': round((T3 - T2) * 1e3), 'total': round((T3 - T0) * 1e3)}
        return res


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--model', default='v4')
    ap.add_argument('--out', default=None)
    ap.add_argument('--crop_dir', default=None)
    a = ap.parse_args()
    r = Detector(a.model).predict_video(a.video, crop_dir=a.crop_dir)
    s = json.dumps(r, ensure_ascii=False, indent=2)
    if a.out:
        open(a.out, 'w', encoding='utf-8').write(s)
    print(s)
