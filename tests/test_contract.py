"""Tests for the v1 data contract: synthetic generation + schema validation."""

from __future__ import annotations

import copy
import json

import pytest

from pitchtwin.contract.synthetic import generate
from pitchtwin.contract.validator import is_valid, load, validate


@pytest.fixture
def instance() -> dict:
    return generate(frames=10, fps=25, seed=0)


def test_synthetic_valid(instance: dict) -> None:
    assert is_valid(instance)


def test_validate_accepts(instance: dict) -> None:
    validate(instance)


def test_schema_const_rejects_wrong_version(instance: dict) -> None:
    instance["schema"] = "wrong"
    assert not is_valid(instance)


def test_bad_coord_type(instance: dict) -> None:
    instance["frames"][0]["players"][0]["x"] = "not-a-number"
    assert not is_valid(instance)


def test_height_out_of_range(instance: dict) -> None:
    instance["frames"][0]["players"][0]["height_est"] = 5.0
    assert not is_valid(instance)


def test_missing_required_field(instance: dict) -> None:
    del instance["frames"][0]["players"][0]["id"]
    assert not is_valid(instance)


def test_jersey_null_number_ok(instance: dict) -> None:
    instance["frames"][0]["players"][0]["jersey"]["number"] = None
    assert is_valid(instance)


def test_jersey_number_over_99_rejected(instance: dict) -> None:
    instance["frames"][0]["players"][0]["jersey"]["number"] = 999
    assert not is_valid(instance)


def test_ball_null_ok(instance: dict) -> None:
    instance["frames"][0]["ball"] = None
    assert is_valid(instance)


def test_possession_enum(instance: dict) -> None:
    instance["frames"][0]["possession"] = "C"
    assert not is_valid(instance)


def test_role_enum(instance: dict) -> None:
    instance["frames"][0]["players"][0]["role"] = "coach"
    assert not is_valid(instance)


def test_additional_property_rejected(instance: dict) -> None:
    instance["frames"][0]["players"][0]["bogus"] = 1
    assert not is_valid(instance)


def test_load_roundtrip(tmp_path, instance: dict) -> None:
    p = tmp_path / "clip.json"
    p.write_text(json.dumps(instance), encoding="utf-8")
    loaded = load(p)
    assert loaded["schema"] == "pitchtwin.frame/v1"
    assert len(loaded["frames"]) == 10


def test_instance_is_deep_copied_by_fixture(instance: dict) -> None:
    snapshot = copy.deepcopy(instance)
    validate(instance)
    assert instance == snapshot
