"""Appearance-based ReID for cross-occlusion / cross-scene ID re-association.

The default backbone is a torchvision MobileNetV3 feature extractor (reliable,
GPU-light, runs on 4 GB). A dedicated person-ReID model (e.g. OSNet on
MSMT17) can be plugged in via :class:`ReidExtractor` for higher accuracy — the
interface (``embed`` -> L2-normalized vectors; cosine-similarity matching) is
unchanged. We don't train our own ReID because we have no cross-view player
identity labels; a pretrained general appearance model is the standard choice.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F

# ReID standard aspect ratio (height x width).
CROP_SIZE = (256, 128)

# ImageNet normalization stats.
_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def _crop(frame: np.ndarray, xyxy: np.ndarray) -> np.ndarray:
    x1, y1, x2, y2 = [int(round(v)) for v in xyxy]
    x1, y1 = max(x1, 0), max(y1, 0)
    x2, y2 = min(x2, frame.shape[1]), min(y2, frame.shape[0])
    return frame[y1:y2, x1:x2]


class ReidExtractor:
    """L2-normalized appearance embeddings for player crops."""

    def __init__(self, device: int | str = 0) -> None:
        from torchvision import models
        from torchvision.transforms import functional as TF

        self.device = device
        self._tf = TF
        # MobileNetV3-Small features -> global avg pool -> 576-d embedding.
        net = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        self.backbone = net.features
        self.backbone.to(device).eval()
        self._mean = _MEAN.to(device)
        self._std = _STD.to(device)

    @torch.inference_mode()
    def embed(self, frame: np.ndarray, boxes: np.ndarray) -> torch.Tensor:
        """Embed each xyxy box in ``frame`` -> (N, D) L2-normalized on ``self.device``."""
        if len(boxes) == 0:
            return torch.zeros((0, 576), device=self.device)
        crops = []
        for b in boxes:
            crop = _crop(frame, b)
            if crop.size == 0:
                crop = np.zeros((CROP_SIZE[0], CROP_SIZE[1], 3), dtype=np.uint8)
            t = self._tf.to_tensor(self._tf.resize(self._tf.to_pil_image(crop), CROP_SIZE[::-1]))
            crops.append(t)
        batch = torch.stack(crops).to(self.device)
        batch = (batch - self._mean) / self._std
        feats = self.backbone(batch)  # (N, C, H, W)
        pooled = feats.adaptive_avg_pool2d(1).flatten(1)  # (N, C)
        return F.normalize(pooled, dim=1)


def cosine_match(
    a: torch.Tensor | np.ndarray,
    b: torch.Tensor | np.ndarray,
    threshold: float = 0.7,
) -> list[tuple[int, int, float]]:
    """Greedy cosine-similarity matches between embedding sets ``a`` and ``b``.

    Returns ``(i, j, sim)`` triples for matched pairs above ``threshold``,
    highest similarity first. Used to re-associate track IDs by appearance.
    """
    if isinstance(a, np.ndarray):
        a = torch.from_numpy(a)
    if isinstance(b, np.ndarray):
        b = torch.from_numpy(b)
    if a.shape[0] == 0 or b.shape[0] == 0:
        return []
    sim = (a @ b.T).cpu().numpy()
    used_b: set[int] = set()
    order = np.dstack(np.unravel_index(np.argsort(-sim, axis=None), sim.shape))[0]
    out = []
    for i, j in order:
        if sim[i, j] < threshold:
            break
        if i in {x[0] for x in out} or j in used_b:
            continue
        out.append((int(i), int(j), float(sim[i, j])))
        used_b.add(j)
    return out
