"""Validate PitchTwin per-frame JSON against the v1 schema."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

SCHEMA_RESOURCE = "pitchtwin.contract"
SCHEMA_FILENAME = "pitchtwin.frame.v1.json"


def schema_path() -> Path:
    """Absolute path to the packaged v1 schema file."""
    repo_schema = Path(__file__).resolve().parents[3] / "schemas" / SCHEMA_FILENAME
    if repo_schema.exists():
        return repo_schema
    with resources.files(SCHEMA_RESOURCE).joinpath(SCHEMA_FILENAME) as p:
        return Path(str(p))


@lru_cache(maxsize=1)
def validator() -> Draft202012Validator:
    """Return a cached validator for the v1 schema."""
    with schema_path().open(encoding="utf-8") as fh:
        schema = json.load(fh)
    return Draft202012Validator(schema)


def validate(instance: dict) -> None:
    """Validate ``instance`` against the v1 schema; raise on the first error.

    Raises
    ------
    jsonschema.ValidationError
        With a helpful message pointing at the offending field.
    """
    errors = sorted(validator().iter_errors(instance), key=lambda e: list(e.path))
    if errors:
        raise best_match(errors)


def is_valid(instance: dict) -> bool:
    """Return True if ``instance`` conforms to the v1 schema."""
    return validator().is_valid(instance)


def load(path: str | Path) -> dict:
    """Read a JSON file and validate it; return the parsed instance."""
    p = Path(path)
    with p.open(encoding="utf-8") as fh:
        instance = json.load(fh)
    validate(instance)
    return instance
