// Detect the "top moments" of a match from per-frame ball/player data: goals,
// shots, saves, tackles, and runs. Each event is scored, windowed, and ranked so
// the viewer can surface the most shareable highlights. Pure post-process on the
// JSON -- no CV pass needed.

const HOLDER_R = 3.0; // a player is "on the ball" within this radius (m)
const DUEL_R = 2.5; // opponent within this radius counts as a duel
const SHOT_SPEED = 14.0; // ball speed (m/s) that reads as a shot
const SAVE_GK_R = 3.0;
const RUN_SPEED = 5.0;
const RUN_MIN_SEC = 1.0;
const RUN_MIN_DIST = 8.0;

export function detectMoments(data, { before = 12, after = 5, goalMouth = 7, topK = 15 } = {}) {
  const frames = data.frames ?? [];
  const fps = data.source?.fps ?? 25;
  const halfL = (data.pitch?.length_m ?? 105) / 2;
  const n = frames.length;

  const sig = computeSignals(frames, fps, halfL);
  const events = [];

  events.push(...detectGoals(frames, sig, fps, halfL, goalMouth));
  events.push(...detectShots(frames, sig, fps, halfL));
  events.push(...detectSaves(frames, sig, fps));
  events.push(...detectTackles(frames, sig, fps));
  events.push(...detectRuns(frames, sig, fps));

  // Window each event, drop overlaps (keep the higher-scored), rank, cap.
  for (const e of events) {
    e.startFrame = Math.max(0, e.peakFrame - Math.round(before * fps));
    e.endFrame = Math.min(n - 1, e.peakFrame + Math.round(after * fps));
    e.t = frames[e.peakFrame]?.t ?? 0;
  }
  events.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const e of events) {
    if (kept.some((k) => !(e.endFrame < k.startFrame || e.startFrame > k.endFrame))) continue;
    kept.push(e);
  }
  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, topK);
}

// Per-frame signals: ball velocity, the ball-holder (nearest player) and team,
// the closest opponent distance, and whether a keeper is on the ball.
function computeSignals(frames, fps, halfL) {
  const n = frames.length;
  const sig = {
    ballX: new Array(n).fill(null),
    ballZ: new Array(n).fill(null),
    ballSpeed: new Array(n).fill(0),
    ballTowardGoal: new Array(n).fill(false),
    holderId: new Array(n).fill(null),
    holderTeam: new Array(n).fill(null),
    holderX: new Array(n).fill(null),
    holderZ: new Array(n).fill(null),
    oppMinDist: new Array(n).fill(Infinity),
    gkOnBall: new Array(n).fill(false),
  };
  let prevBallI = -1;
  for (let i = 0; i < n; i++) {
    const b = frames[i].ball;
    if (!b || b.tracked === false) continue;
    sig.ballX[i] = b.x;
    sig.ballZ[i] = b.z;
    if (prevBallI >= 0) {
      const dt = (i - prevBallI) / fps;
      if (dt > 0 && dt < 0.5) {
        const dx = b.x - sig.ballX[prevBallI];
        const dz = b.z - sig.ballZ[prevBallI];
        sig.ballSpeed[i] = Math.hypot(dx, dz) / dt;
        const toward = b.x > 0 ? dx > 0.5 : dx < -0.5;
        sig.ballTowardGoal[i] = toward;
      }
    }
    prevBallI = i;

    let bestD = HOLDER_R;
    let holder = null;
    let oppMin = Infinity;
    for (const p of frames[i].players) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bestD) {
        bestD = d;
        holder = p;
      }
      if (holder && p.team !== holder.team && d < oppMin) oppMin = d;
      if (p.role === "gk" && d < SAVE_GK_R) sig.gkOnBall[i] = true;
    }
    if (holder) {
      sig.holderId[i] = holder.id;
      sig.holderTeam[i] = holder.team;
      sig.holderX[i] = holder.x;
      sig.holderZ[i] = holder.z;
      sig.oppMinDist[i] = oppMin;
    }
  }
  return sig;
}

function cluster(indices, gap) {
  const out = [];
  for (const idx of indices) {
    const last = out[out.length - 1];
    if (last && idx - last[last.length - 1] <= gap) last.push(idx);
    else out.push([idx]);
  }
  return out;
}

function detectGoals(frames, sig, fps, halfL, goalMouth) {
  const goalFrames = [];
  for (let i = 0; i < frames.length; i++) {
    if (
      sig.ballX[i] != null &&
      Math.abs(sig.ballX[i]) >= halfL &&
      Math.abs(sig.ballZ[i]) <= goalMouth &&
      wasApproaching(sig, i, fps)
    ) {
      goalFrames.push(i);
    }
  }
  const events = [];
  for (const cl of cluster(goalFrames, Math.round(2 * fps))) {
    let peak = cl[0];
    for (const idx of cl) if (Math.abs(sig.ballX[idx]) > Math.abs(sig.ballX[peak])) peak = idx;
    const scorer = lastToucher(frames, sig, peak, fps, 1.5);
    events.push({
      type: "goal",
      peakFrame: peak,
      playerId: scorer?.id ?? null,
      team: scorer?.team ?? null,
      score: 100,
    });
  }
  return events;
}

function detectShots(frames, sig, fps, halfL) {
  const shotFrames = [];
  for (let i = 0; i < frames.length; i++) {
    if (
      sig.ballSpeed[i] >= 18 &&
      sig.ballTowardGoal[i] &&
      Math.abs(sig.ballX[i]) >= halfL * 0.4 &&
      hadRecentHolder(sig, i, fps)
    ) {
      shotFrames.push(i);
    }
  }
  const events = [];
  for (const cl of cluster(shotFrames, Math.round(0.8 * fps))) {
    let peak = cl[0];
    for (const idx of cl) if (sig.ballSpeed[idx] > sig.ballSpeed[peak]) peak = idx;
    // Skip shots that immediately become a goal -- the goal event covers them.
    if (becomesGoalWithin(sig, peak, halfL, Math.round(1.0 * fps))) continue;
    const shooter = recentHolder(sig, peak, fps);
    if (!shooter) continue; // no identifiable shooter -> likely a clearance, not a shot
    events.push({
      type: "shot",
      peakFrame: peak,
      playerId: shooter.id,
      team: shooter.team,
      score: 35 + Math.min(25, sig.ballSpeed[peak] - 18),
    });
  }
  return events;
}

function recentHolder(sig, idx, fps, sec = 0.6) {
  for (let k = Math.min(sig.holderId.length - 1, idx); k >= Math.max(0, idx - Math.round(sec * fps)); k--) {
    if (sig.holderId[k] != null) return { id: sig.holderId[k], team: sig.holderTeam[k] };
  }
  return null;
}

function wasApproaching(sig, idx, fps, sec = 1.0) {
  for (let k = Math.max(0, idx - Math.round(sec * fps)); k < idx; k++) {
    if (sig.ballTowardGoal[k]) return true;
  }
  return false;
}

function hadRecentHolder(sig, idx, fps, sec = 0.6) {
  for (let k = Math.max(0, idx - Math.round(sec * fps)); k <= idx; k++) {
    if (sig.holderId[k] != null) return true;
  }
  return false;
}

function becomesGoalWithin(sig, fromIdx, halfL, lookahead) {
  for (let i = fromIdx; i < Math.min(sig.ballX.length, fromIdx + lookahead); i++) {
    if (sig.ballX[i] != null && Math.abs(sig.ballX[i]) >= halfL) return true;
  }
  return false;
}

function detectSaves(frames, sig, fps) {
  const events = [];
  const n = frames.length;
  for (let i = 1; i < n; i++) {
    // A save: a shot was heading to goal, a keeper gets on the ball, and the
    // ball then moves back away from goal.
    if (
      sig.gkOnBall[i] &&
      sig.ballSpeed[i] >= SHOT_SPEED * 0.6 &&
      sig.ballTowardGoal[i - 1] &&
      !sig.ballTowardGoal[i]
    ) {
      events.push({
        type: "save",
        peakFrame: i,
        playerId: sig.holderId[i],
        team: sig.holderTeam[i],
        score: 55,
      });
    }
  }
  return events;
}

function detectTackles(frames, sig, fps) {
  const events = [];
  const n = frames.length;
  const cool = Math.round(1.0 * fps);
  let lastEventEnd = -cool;
  for (let i = 1; i < n; i++) {
    const a = sig.holderTeam[i - 1];
    const b = sig.holderTeam[i];
    if (a && b && a !== b && i - lastEventEnd >= cool) {
      // Was an opponent close in the build-up? (a real duel, not a loose pickup)
      let dueled = false;
      for (let k = Math.max(0, i - Math.round(0.6 * fps)); k <= i; k++) {
        if (sig.oppMinDist[k] <= DUEL_R) {
          dueled = true;
          break;
        }
      }
      if (dueled) {
        events.push({
          type: "tackle",
          peakFrame: i,
          playerId: sig.holderId[i],
          team: b,
          score: 28,
        });
        lastEventEnd = i;
      }
    }
  }
  return events;
}

function detectRuns(frames, sig, fps) {
  const events = [];
  const n = frames.length;
  const minFrames = Math.round(RUN_MIN_SEC * fps);
  let i = 0;
  while (i < n) {
    if (sig.holderId[i] == null) {
      i++;
      continue;
    }
    const id = sig.holderId[i];
    let j = i;
    while (j < n && sig.holderId[j] === id) j++;
    // segment [i, j) of continuous possession by one player
    if (j - i >= minFrames) {
      const dist = Math.hypot(sig.holderX[j - 1] - sig.holderX[i], sig.holderZ[j - 1] - sig.holderZ[i]);
      const dt = (j - 1 - i) / fps;
      const speed = dt > 0 ? dist / dt : 0;
      if (speed >= RUN_SPEED && dist >= RUN_MIN_DIST) {
        events.push({
          type: "run",
          peakFrame: Math.round((i + j) / 2),
          playerId: id,
          team: sig.holderTeam[i],
          score: 20 + Math.min(15, dist - RUN_MIN_DIST),
        });
      }
    }
    i = j;
  }
  return events;
}

// The last player to touch the ball before a moment (nearest to it in lookback).
function lastToucher(frames, sig, peak, fps, lookbackSec) {
  const start = Math.max(0, peak - Math.round(lookbackSec * fps));
  const tally = new Map();
  for (let f = start; f <= peak; f++) {
    const b = frames[f].ball;
    if (!b) continue;
    for (const p of frames[f].players) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      const e = tally.get(p.id);
      if (!e || d < e.minDist) tally.set(p.id, { minDist: d, team: p.team });
    }
  }
  let best = null;
  let bestD = Infinity;
  for (const [id, e] of tally) {
    if (e.minDist < bestD) {
      bestD = e.minDist;
      best = { id, team: e.team };
    }
  }
  return best;
}
