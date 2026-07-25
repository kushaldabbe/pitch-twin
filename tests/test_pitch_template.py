"""Tests for the FIFA pitch template (the accuracy-critical geometry)."""

from __future__ import annotations

import numpy as np
import pytest

from pitchtwin.calibration.pitch_template import (
    NUM_KEYPOINTS,
    PENALTY_AREA_DEPTH,
    PitchTemplate,
    template_to_pitch,
)


@pytest.fixture
def tpl() -> PitchTemplate:
    return PitchTemplate()  # default 105 x 68


def test_vertex_count_and_shape(tpl: PitchTemplate) -> None:
    v = tpl.vertices
    assert v.shape == (NUM_KEYPOINTS, 2)


def test_corners(tpl: PitchTemplate) -> None:
    v = tpl.vertices
    assert np.allclose(v[0], (0.0, 0.0))  # top-left
    assert np.allclose(v[5], (0.0, 68.0))  # bottom-left
    assert np.allclose(v[24], (105.0, 0.0))  # top-right
    assert np.allclose(v[29], (105.0, 68.0))  # bottom-right


def test_penalty_spots(tpl: PitchTemplate) -> None:
    v = tpl.vertices
    assert np.allclose(v[8], (11.0, 34.0))  # left penalty spot
    assert np.allclose(v[21], (94.0, 34.0))  # right penalty spot (105 - 11)


def test_penalty_box_depth_is_fifa_16_5(tpl: PitchTemplate) -> None:
    """Guards the FIFA correction: 16.5 m, not the reference's 20.15 m."""
    v = tpl.vertices
    assert PENALTY_AREA_DEPTH == 16.5
    assert np.allclose(v[9][0], 16.5)  # left penalty-box far edge x
    assert np.allclose(v[12][0], 16.5)
    assert np.allclose(v[17][0], 105.0 - 16.5)  # right penalty-box far edge x
    assert np.allclose(v[20][0], 105.0 - 16.5)


def test_goal_box_depth(tpl: PitchTemplate) -> None:
    v = tpl.vertices
    assert np.allclose(v[6][0], 5.5)  # left goal-box far edge
    assert np.allclose(v[22][0], 105.0 - 5.5)  # right goal-box far edge


def test_centre_circle(tpl: PitchTemplate) -> None:
    v = tpl.vertices
    assert np.allclose(v[14], (52.5, 34.0 - 9.15))  # centre circle top
    assert np.allclose(v[15], (52.5, 34.0 + 9.15))  # centre circle bottom
    assert np.allclose(v[30], (52.5 - 9.15, 34.0))  # centre circle left
    assert np.allclose(v[31], (52.5 + 9.15, 34.0))  # centre circle right


def test_left_right_symmetry(tpl: PitchTemplate) -> None:
    """Each left keypoint mirrors a right keypoint about the halfway line."""
    v = tpl.vertices
    # (left_idx, right_idx) — same y, x mirrored about x = length/2.
    pairs = [
        (0, 24),
        (1, 25),
        (2, 26),
        (3, 27),
        (4, 28),
        (5, 29),
        (6, 22),
        (7, 23),
        (8, 21),
        (9, 17),
        (10, 18),
        (11, 19),
        (12, 20),
    ]
    for left, right in pairs:
        assert pytest.approx(v[right][0]) == 105.0 - v[left][0]
        assert pytest.approx(v[right][1]) == v[left][1]


def test_template_to_pitch_center_origin(tpl: PitchTemplate) -> None:
    # Top-left corner (0,0) -> (-52.5, -34); bottom-right (105,68) -> (+52.5, +34).
    p = template_to_pitch(np.array([[0.0, 0.0], [105.0, 68.0]]))
    assert np.allclose(p[0], (-52.5, -34.0))
    assert np.allclose(p[1], (52.5, 34.0))


def test_edges_are_in_range(tpl: PitchTemplate) -> None:
    for a, b in tpl.edges:
        assert 0 <= a < NUM_KEYPOINTS
        assert 0 <= b < NUM_KEYPOINTS
        assert a != b
