"""Homography estimation and image -> pitch-coordinate projection.

Pipeline per frame:

    pitch keypoints (image px, with confidence)
        |-- filter by confidence, require >= ``min_points``
        v
    cv2.findHomography(img -> template meters, RANSAC)
        |-- EMA smoothing across frames (new)
        |-- hold last good H when too few keypoints (new)
        v
    project detection footpoints -> template meters -> centered pitch meters
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from pitchtwin.calibration.pitch_template import (
    NUM_KEYPOINTS,
    PitchTemplate,
    template_to_pitch,
)


def compute_homography(
    image_pts: np.ndarray, template_pts: np.ndarray, ransac_thresh: float = 5.0
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Fit image->template homography with RANSAC.

    Returns ``(H, inlier_mask)`` or ``(None, None)`` if too few points / no fit.
    """
    if image_pts.shape[0] < 4:
        return None, None
    H, mask = cv2.findHomography(
        image_pts.reshape(-1, 1, 2).astype(np.float32),
        template_pts.reshape(-1, 1, 2).astype(np.float32),
        cv2.RANSAC,
        ransac_thresh,
    )
    return H, (mask.ravel().astype(bool) if mask is not None else None)


def reprojection_error_m(
    image_pts: np.ndarray, template_pts: np.ndarray, H: np.ndarray, mask: np.ndarray | None = None
) -> float:
    """Mean forward reprojection error in meters over inliers."""
    pred = cv2.perspectiveTransform(image_pts.reshape(-1, 1, 2).astype(np.float32), H).reshape(
        -1, 2
    )
    err = np.linalg.norm(pred - template_pts, axis=1)
    if mask is not None:
        err = err[mask]
    return float(err.mean()) if err.size else float("nan")


def footpoint_from_xyxy(xyxy: np.ndarray) -> np.ndarray:
    """Bottom-center of each bbox — the point on the ground plane."""
    x1, _, x2, y2 = xyxy[..., 0], xyxy[..., 1], xyxy[..., 2], xyxy[..., 3]
    return np.stack([(x1 + x2) / 2.0, y2], axis=-1)  # (N, 2)


def _normalize_H(H: np.ndarray) -> np.ndarray:
    """Scale H so H[2,2] = 1 (canonical form for arithmetic)."""
    return H / H[2, 2]


@dataclass
class Calibrator:
    """Stateful per-frame homography with smoothing and failure recovery.

    Improvements over the reference pipeline (which recomputed every 30 frames
    with no smoothing and no recovery):

    * per-frame estimation (configurable stride),
    * EMA smoothing of the normalized homography,
    * "hold last good H" when confident keypoints drop below ``min_points``.
    """

    template: PitchTemplate = None  # type: ignore[assignment]
    min_points: int = 4
    conf_threshold: float = 0.5
    ransac_thresh: float = 5.0
    smoothing_alpha: float = 0.3  # weight on the new H (1.0 = no smoothing)
    max_hold: int = 30  # frames to keep the last good H before giving up

    def __post_init__(self) -> None:
        if self.template is None:
            self.template = PitchTemplate()
        self.H: np.ndarray | None = None
        self.frames_held: int = 0
        self.last_error: float | None = None

    def update(self, keypoints: np.ndarray) -> tuple[np.ndarray | None, float | None]:
        """Process one frame's keypoints: ``(NUM_KEYPOINTS, 3)`` = (x_px, y_px, conf).

        Returns ``(H, mean_reproj_error_m)``. ``H`` may be a held previous value
        (``error is None``) when the current frame had too few confident points.
        """
        assert keypoints.shape == (NUM_KEYPOINTS, 3), f"bad shape {keypoints.shape}"
        sel = keypoints[:, 2] >= self.conf_threshold
        if int(sel.sum()) >= self.min_points:
            img = keypoints[sel, :2]
            tmpl = self.template.vertices[sel]
            H, mask = compute_homography(img, tmpl, self.ransac_thresh)
            if H is not None:
                H = _normalize_H(H)
                err = reprojection_error_m(img, tmpl, H, mask)
                H = self._smooth(H)
                self.H = H
                self.frames_held = 0
                self.last_error = err
                return H, err

        # Failure path: hold the last good homography.
        self.frames_held += 1
        if self.H is not None and self.frames_held <= self.max_hold:
            return self.H, None
        return None, None

    def _smooth(self, H_new: np.ndarray) -> np.ndarray:
        if self.H is None or self.smoothing_alpha >= 1.0:
            return H_new
        a = self.smoothing_alpha
        return _normalize_H(a * H_new + (1.0 - a) * self.H)

    def image_to_pitch(self, image_xy: np.ndarray) -> np.ndarray | None:
        """Project image points (..., 2) to centered pitch meters (..., 2)."""
        if self.H is None:
            return None
        image_xy = np.asarray(image_xy, dtype=np.float32)
        tmpl = cv2.perspectiveTransform(image_xy.reshape(-1, 1, 2), self.H).reshape(-1, 2)
        pitch = template_to_pitch(tmpl, self.template.length, self.template.width)
        return pitch.reshape(image_xy.shape)
