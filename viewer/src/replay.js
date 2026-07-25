import * as THREE from "three";

const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest-path angular interpolation (radians). */
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const playersToMap = (arr) => {
  const m = new Map();
  for (const p of arr) m.set(p.id, p);
  return m;
};

/**
 * Holds the loaded per-frame data and drives time-based playback with
 * frame-to-frame interpolation (so playback fps can differ from data fps).
 */
export class Replay {
  constructor(data) {
    this.load(data);
    this.t = 0;
    this.playing = false;
    this.speed = 1;
  }

  load(data) {
    this.data = data;
    this.frames = data.frames ?? [];
    this.fps = data.source?.fps ?? 25;
    this.lengthM = data.pitch?.length_m ?? 105;
    this.widthM = data.pitch?.width_m ?? 68;
    this.duration = this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  get frameCount() {
    return this.frames.length;
  }

  togglePlay() {
    if (this.t >= this.duration) this.t = 0;
    this.playing = !this.playing;
    return this.playing;
  }

  setSpeed(s) {
    this.speed = s;
  }

  /** Seek to a normalized scrubber position in [0, 1]. */
  seekFraction(f) {
    this.t = Math.max(0, Math.min(1, f)) * this.duration;
  }

  update(dt) {
    if (!this.playing) return;
    this.t += dt * this.speed;
    if (this.t >= this.duration) {
      this.t = this.duration;
      this.playing = false;
    }
  }

  /** Binary-search the frame index whose time is <= t. */
  _floorIndex(t) {
    let lo = 0;
    let hi = this.frames.length - 1;
    if (t <= this.frames[0].t) return 0;
    if (t >= this.frames[hi].t) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Return an interpolated frame state at the current time. */
  state() {
    const n = this.frames.length;
    if (n === 0) return { ball: null, players: [], possession: null, score: null, t: this.t, frame: -1 };
    const i = this._floorIndex(this.t);
    const floor = this.frames[i];
    const ceil = i + 1 < n ? this.frames[i + 1] : null;

    if (!ceil || ceil.t === floor.t) {
      return { ...floor, frame: i, t: this.t };
    }
    const a = (this.t - floor.t) / (ceil.t - floor.t);
    const fpm = playersToMap(floor.players);
    const cpm = playersToMap(ceil.players);

    const ids = new Set([...fpm.keys(), ...cpm.keys()]);
    const players = [];
    for (const id of ids) {
      const fp = fpm.get(id);
      const cp = cpm.get(id);
      if (fp && cp) {
        players.push({
          ...fp,
          x: lerp(fp.x, cp.x, a),
          z: lerp(fp.z, cp.z, a),
          facing: lerpAngle(fp.facing ?? 0, cp.facing ?? 0, a),
          speed: lerp(fp.speed ?? 0, cp.speed ?? 0, a),
        });
      } else {
        players.push(fp ?? cp);
      }
    }

    let ball = null;
    if (floor.ball && ceil.ball) {
      ball = {
        ...floor.ball,
        x: lerp(floor.ball.x, ceil.ball.x, a),
        z: lerp(floor.ball.z, ceil.ball.z, a),
        y: lerp(floor.ball.y ?? 0, ceil.ball.y ?? 0, a),
      };
    } else {
      ball = floor.ball ?? ceil.ball ?? null;
    }

    return {
      frame: i,
      t: this.t,
      ball,
      players,
      possession: ceil.possession ?? floor.possession,
      score: ceil.score ?? floor.score,
    };
  }
}

export const _vec = new THREE.Vector3();
