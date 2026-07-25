"""Detection module configuration (re-derived; no code copied from reference repos)."""

from __future__ import annotations

from pathlib import Path

# Repo root = three levels up: detection/ -> pitchtwin/ -> src/ -> repo.
REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET_DIR = REPO_ROOT / "data" / "datasets" / "football-players-detection"
DATA_YAML = DATASET_DIR / "data.yaml"

# Class order MUST match data.yaml: ball, goalkeeper, player, referee.
CLASS_NAMES = ("ball", "goalkeeper", "player", "referee")
NUM_CLASSES = len(CLASS_NAMES)
CLASS_TO_ID = {name: i for i, name in enumerate(CLASS_NAMES)}
BALL, GOALKEEPER, PLAYER, REFEREE = range(NUM_CLASSES)

# Training hyperparameters — tuned for a 4 GB GPU (GTX 1650 Ti).
MODEL_NAME = "yolov8s.pt"  # small detector; best accuracy/size tradeoff
IMGSZ = 640
BATCH = 4
EPOCHS = 40
PATIENCE = 15

# Outputs.
WEIGHTS_DIR = REPO_ROOT / "runs" / "detect" / "football-detect"
BEST_WEIGHTS = WEIGHTS_DIR / "weights" / "best.pt"
LAST_WEIGHTS = WEIGHTS_DIR / "weights" / "last.pt"
