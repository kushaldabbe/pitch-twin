# PitchTwin

> Real-time **3D digital-twin of a football match**, reconstructed from 2D broadcast video — *pixels in, 3D experience out.*

PitchTwin rebuilds the play as an interactive 3D replay: a tactical top-down view, a free-orbit camera, and (later) a first-person view from any player's head. The tracking feed is **reconstructed from raw video with its own CV pipeline** — no proprietary league data required.

## Status

Early / in active development.

- ✅ Data contract (per-frame JSON `v1`) + schema validator + deterministic synthetic generator
- ✅ Three.js viewer MVP — 3D pitch, team-colored player markers with jersey labels, ball, tactical/orbit cameras, scrubber
- 🚧 CV pipeline (detection, calibration/homography, tracking+ReID, teams, jersey OCR, analytics)

## How it works

```
broadcast video
     │
     ▼
┌─────────────── CV pipeline (Python) ───────────────┐
│ detect → track (BoT-SORT + ReID) → calibrate        │
│ (homography) → teams → jersey OCR → analytics       │
└───────────────────────┬─────────────────────────────┘
                        │  per-frame JSON  (pitchtwin.frame/v1)
                        ▼
┌─────────────── Viewer (Three.js / WebGL) ──────────┐
│ pitch + avatars + ball → tactical/orbit cameras     │
│ + scrubber → deployable web demo                    │
└─────────────────────────────────────────────────────┘
```

The JSON file is the **only** coupling between the Python producer and the JS viewer. The viewer can be developed against a synthetic clip while the CV pipeline is built.

## Prerequisites

- **Python ≥ 3.10** (developed on 3.12)
- **Node ≥ 18** (developed on 26)
- An **NVIDIA GPU** is strongly recommended for the CV pipeline (developed on a 4 GB GTX 1650 Ti). The viewer and data-contract tooling run on CPU.

## Quick start

### 1. Python environment

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate

pip install -e ".[dev]"            # contract + tests + linting

# GPU torch (CUDA 11.8) — install separately so it pulls the CUDA wheel, not the CPU one:
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# Optional CV stack (detection, tracking, calibration, …)
pip install -e ".[cv]"
```

Verify CUDA:

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

### 2. Generate the synthetic demo clip

```bash
python -m pitchtwin.contract.synthetic --out data/sample_clip/synthetic.json --frames 750
```

### 3. Run the viewer

```bash
cd viewer
npm install
npm run dev          # http://localhost:5173
```

The dev server serves the live `data/sample_clip/synthetic.json`, so regenerating it is reflected on refresh. For a production build (bakes the sample in):

```bash
npm run build        # outputs viewer/dist/
npm run preview
```

## Environment variables

Create a `.env` (gitignored) from the variables below. These are only needed for dataset downloads, not for the viewer or synthetic data.

| Variable | Used by | Notes |
|---|---|---|
| `ROBOFLOW_API_KEY` | Roboflow dataset download | Get a free key at app.roboflow.com |
| `SOCCERNET_USERNAME` / `SOCCERNET_PASSWORD` | SoccerNet (optional) | The `frames` task used here needs no login |

## Datasets

Training/eval data is downloaded on demand (never committed). See `src/pitchtwin/data/download.py`.

```bash
# SoccerNet v3 frames (extra broadcast training images; no login required)
python -m pitchtwin.data.download soccernet --split valid --n-games 10
```

Roboflow datasets (player detection, pitch keypoints) carry the box/keypoint labels and are the primary training source.

## Project structure

```
pitch-twin/
├── schemas/pitchtwin.frame.v1.json   # THE data contract (CV ↔ viewer interface)
├── src/pitchtwin/                    # Python CV producer
│   ├── contract/                     # schema validation + synthetic generator
│   ├── data/                         # dataset downloaders
│   ├── detection/ ball/ calibration/ tracking/ teams/
│   ├── identity/ pose/ analytics/ pipeline/ export/   # CV modules (in progress)
│   └── cli.py
├── tests/                            # pytest
├── viewer/                           # Three.js + Vite consumer
│   └── src/{main,scene,replay,avatar,camera}.js
└── data/                             # gitignored — datasets + generated samples
```

## Data contract

Per-frame JSON conforming to `schemas/pitchtwin.frame.v1.json`. Coordinates are **pitch meters** (origin at the center spot): `x` along the touchline, `z` along the goal line, `y` is height. See the schema for the full field list, including `player.jersey {number, conf}`, `ball.vel/conf/tracked`, and `possession`.

Validate any file:

```bash
python -m pitchtwin.cli validate path/to/clip.json
```

## Testing

```bash
pytest                 # contract: schema validation + synthetic generation
ruff check src tests   # lint
ruff format src tests  # format
```

## Roadmap

- **Stage 0** — CV pipeline: detection, dedicated ball model, calibration/homography (+ scene-cut + smoothing), tracking+ReID, team classification, jersey OCR, player pose, analytics, exporter, orchestrator.
- **Stage 1** — Viewer MVP *(in progress)* — deploy to a public URL.
- **Stage 2** — Pose-driven avatars; first-person & follow cameras.
- **Stage 3** — Ball physics (height/trajectory) + stat overlays.
- **Stage 4** — Polish + deployed public demo.

## License

[MIT](./LICENSE)
