"""PitchTwin command-line interface."""

from __future__ import annotations

import json
from pathlib import Path

import click


@click.group()
@click.version_option(package_name="pitchtwin")
def main() -> None:
    """PitchTwin — 3D match digital twin from broadcast video."""


@main.command()
@click.option("--out", default="data/sample_clip/synthetic.json", help="Output JSON path.")
@click.option("--frames", type=int, default=750, help="Number of frames to generate.")
@click.option("--fps", type=float, default=25.0, help="Source fps.")
@click.option("--seed", type=int, default=42, help="RNG seed for determinism.")
def synthetic(out: str, frames: int, fps: float, seed: int) -> None:
    """Generate a synthetic v1 clip (for viewer development before CV exists)."""
    from pitchtwin.contract.synthetic import generate
    from pitchtwin.contract.validator import validate

    instance = generate(frames=frames, fps=fps, seed=seed)
    validate(instance)
    p = Path(out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(instance), encoding="utf-8")
    click.echo(f"wrote {p} ({len(instance['frames'])} frames)")


@main.command()
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
def validate(path: Path) -> None:
    """Validate a JSON file against the v1 schema."""
    from pitchtwin.contract.validator import load

    load(path)
    click.echo(f"OK: {path}")


if __name__ == "__main__":
    main()
