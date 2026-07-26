"""Scene-cut detection for broadcast video.

Splits a clip into continuous camera shots via HSV-histogram correlation.
Used to (a) reset the tracker at each cut and (b) re-initialize the homography,
since both assume a fixed camera within a shot.
"""

from __future__ import annotations

import cv2
import numpy as np


def hsv_histogram(frame: np.ndarray) -> np.ndarray:
    """Normalized 2D H-S histogram (robust to small brightness changes)."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten().astype(np.float32)


class SceneSegmentor:
    """Online scene-change detector. Call :meth:`update` once per frame in order."""

    def __init__(self, threshold: float = 0.5, min_gap: int = 5) -> None:
        self.threshold = threshold
        self.min_gap = min_gap  # frames between detected cuts (debounce)
        self._prev: np.ndarray | None = None
        self._frames_since_cut = 0

    def update(self, frame: np.ndarray) -> bool:
        """Return True if this frame begins a new scene (a cut)."""
        self._frames_since_cut += 1
        hist = hsv_histogram(frame)
        if self._prev is None:
            self._prev = hist
            return True  # first frame counts as a scene start

        score = float(cv2.compareHist(self._prev, hist, cv2.HISTCMP_CORREL))
        self._prev = hist
        is_cut = score < self.threshold and self._frames_since_cut >= self.min_gap
        if is_cut:
            self._frames_since_cut = 0
        return is_cut
