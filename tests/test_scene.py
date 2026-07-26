"""Tests for the scene-cut detector (deterministic, CPU-only)."""

from __future__ import annotations

import numpy as np

from pitchtwin.tracking.scene import SceneSegmentor


def _frame(b: int, g: int, r: int) -> np.ndarray:
    img = np.zeros((100, 100, 3), np.uint8)
    img[:] = (b, g, r)
    return img


def test_first_frame_counts_as_scene_start() -> None:
    seg = SceneSegmentor()
    assert seg.update(_frame(0, 200, 0)) is True


def test_identical_frames_do_not_trigger_cut() -> None:
    seg = SceneSegmentor()
    f = _frame(0, 200, 0)
    seg.update(f)
    assert seg.update(f) is False
    assert seg.update(f) is False


def test_large_color_change_triggers_cut() -> None:
    seg = SceneSegmentor(threshold=0.5, min_gap=5)
    green = _frame(0, 200, 0)
    blue = _frame(200, 0, 0)
    seg.update(green)  # scene start
    for _ in range(5):
        seg.update(green)  # build the min_gap; identical -> no cut
    assert seg.update(blue) is True  # big change after gap -> cut
