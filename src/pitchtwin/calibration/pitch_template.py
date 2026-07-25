"""FIFA-standard football pitch template with the 32 keypoints used by the
Roboflow football-field-detection dataset.

The keypoint *index -> landmark* semantics follow the dataset / the
roboflow/sports reference, but the physical coordinates are recomputed from
FIFA rules (not copied). Two corrections vs. that reference, both in service
of physically-accurate meters:

* Overall pitch is 105 x 68 m (international standard, matches the data
  contract) rather than 120 x 70.
* Penalty-area depth is 16.5 m (FIFA) rather than 20.15 m (the reference
  conflated depth with the half-width 20.15 m). Keeping all 32 keypoints
  geometrically consistent also improves the RANSAC fit.

Coordinate system of the template itself: origin at the **top-left corner**,
``x`` along the length (touchline), ``y`` along the width (goal line), both in
meters. Use :func:`template_to_pitch` to convert to the data-contract frame
(origin at the center spot) when emitting v1 JSON.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

# FIFA-standard marking dimensions (meters); these are fixed across pitches.
PENALTY_AREA_DEPTH = 16.5  # from goal line
PENALTY_AREA_HALF_WIDTH = 20.15  # half of 40.3 m
GOAL_AREA_DEPTH = 5.5
GOAL_AREA_HALF_WIDTH = 9.16  # half of 18.32 m
CENTRE_CIRCLE_RADIUS = 9.15
PENALTY_SPOT_DISTANCE = 11.0  # from goal line

NUM_KEYPOINTS = 32


@dataclass
class PitchTemplate:
    """Metric pitch geometry + the 32-keypoint world coordinates.

    ``length`` / ``width`` are configurable (real pitches vary); marking
    dimensions are FIFA-fixed.
    """

    length: float = 105.0
    width: float = 68.0

    @property
    def vertices(self) -> np.ndarray:
        """(32, 2) world coordinates in meters, top-left origin.

        Index ``i`` corresponds to model keypoint ``i`` (0-based), matching the
        Roboflow football-field-detection keypoint order.
        """
        L, W = self.length, self.width
        pad, paw = PENALTY_AREA_DEPTH, 2 * PENALTY_AREA_HALF_WIDTH
        gad, gaw = GOAL_AREA_DEPTH, 2 * GOAL_AREA_HALF_WIDTH
        ccr = CENTRE_CIRCLE_RADIUS
        psd = PENALTY_SPOT_DISTANCE

        # y-extents (along goal line) shared by both boxes on each side.
        pa_top = (W - paw) / 2  # penalty box edge near top touchline
        pa_bot = (W + paw) / 2  # ... near bottom touchline
        ga_top = (W - gaw) / 2
        ga_bot = (W + gaw) / 2

        v = [
            # --- LEFT side (goal line at x = 0) ---
            (0.0, 0.0),  # 0  top-left corner
            (0.0, pa_top),  # 1  left penalty-box top
            (0.0, ga_top),  # 2  left goal-box top
            (0.0, ga_bot),  # 3  left goal-box bottom
            (0.0, pa_bot),  # 4  left penalty-box bottom
            (0.0, W),  # 5  bottom-left corner
            (gad, ga_top),  # 6  left goal-box far top
            (gad, ga_bot),  # 7  left goal-box far bottom
            (psd, W / 2),  # 8  left penalty spot
            (pad, pa_top),  # 9  left penalty-box far top
            (pad, ga_top),  # 10 left penalty/goal-box junction top
            (pad, ga_bot),  # 11 ... junction bottom
            (pad, pa_bot),  # 12 left penalty-box far bottom
            # --- MIDFIELD ---
            (L / 2, 0.0),  # 13 halfway line top
            (L / 2, W / 2 - ccr),  # 14 centre circle top
            (L / 2, W / 2 + ccr),  # 15 centre circle bottom
            (L / 2, W),  # 16 halfway line bottom
            # --- RIGHT side (goal line at x = L) ---
            (L - pad, pa_top),  # 17 right penalty-box far top
            (L - pad, ga_top),  # 18 right junction top
            (L - pad, ga_bot),  # 19 right junction bottom
            (L - pad, pa_bot),  # 20 right penalty-box far bottom
            (L - psd, W / 2),  # 21 right penalty spot
            (L - gad, ga_top),  # 22 right goal-box far top
            (L - gad, ga_bot),  # 23 right goal-box far bottom
            (L, 0.0),  # 24 top-right corner
            (L, pa_top),  # 25 right penalty-box top
            (L, ga_top),  # 26 right goal-box top
            (L, ga_bot),  # 27 right goal-box bottom
            (L, pa_bot),  # 28 right penalty-box bottom
            (L, W),  # 29 bottom-right corner
            # --- CENTRE CIRCLE sides ---
            (L / 2 - ccr, W / 2),  # 30 centre circle left
            (L / 2 + ccr, W / 2),  # 31 centre circle right
        ]
        assert len(v) == NUM_KEYPOINTS, f"expected {NUM_KEYPOINTS} vertices, got {len(v)}"
        return np.asarray(v, dtype=np.float32)

    edges: Sequence[tuple[int, int]] = field(
        default_factory=lambda: [
            # 0-based index pairs (subtract 1 from the conventional 1-based refs).
            (0, 1),
            (1, 2),
            (2, 3),
            (3, 4),
            (4, 5),
            (6, 7),
            (9, 10),
            (10, 11),
            (11, 12),
            (13, 14),
            (14, 15),
            (15, 16),
            (17, 18),
            (18, 19),
            (19, 20),
            (22, 23),
            (24, 25),
            (25, 26),
            (26, 27),
            (27, 28),
            (28, 29),
            (0, 13),
            (1, 9),
            (2, 6),
            (3, 7),
            (4, 12),
            (5, 16),
            (13, 24),
            (17, 25),
            (22, 26),
            (23, 27),
            (20, 28),
            (16, 29),
        ]
    )


def template_to_pitch(
    template_xy: np.ndarray, length: float = 105.0, width: float = 68.0
) -> np.ndarray:
    """Convert template (top-left origin) coords -> data-contract pitch coords.

    Output frame: origin at the center spot, ``x`` along the touchline
    (length, +/-length/2), ``z`` along the goal line (width, +/-width/2).
    Input and output shape match: ``(..., 2)`` with columns ``(template_x,
    template_y)`` -> ``(pitch_x, pitch_z)``.
    """
    template_xy = np.asarray(template_xy, dtype=np.float32)
    out = np.empty_like(template_xy)
    out[..., 0] = template_xy[..., 0] - length / 2.0  # x along length
    out[..., 1] = template_xy[..., 1] - width / 2.0  # z along width
    return out
