// Detect "score moments" (goals) from a clip's per-frame ball/player data and
// attach a cinematic window around each one plus the likely scorer. This is a
// pure post-process on the JSON -- no CV pass needed.

export function detectMoments(
  data,
  { lookback = 1.5, before = 20, after = 8, goalMouth = 7, clusterGap = 2.0 } = {},
) {
  const frames = data.frames ?? [];
  const fps = data.source?.fps ?? 25;
  const halfL = (data.pitch?.length_m ?? 105) / 2;
  const n = frames.length;

  // Goal frames: ball over the line, within the goal mouth.
  const goalFrames = [];
  for (let i = 0; i < n; i++) {
    const b = frames[i].ball;
    if (b && b.tracked !== false && Math.abs(b.x) >= halfL && Math.abs(b.z) <= goalMouth) {
      goalFrames.push(i);
    }
  }

  // Cluster goal frames within ``clusterGap`` seconds into one event.
  const clusters = [];
  for (const idx of goalFrames) {
    const last = clusters[clusters.length - 1];
    if (last && idx - last[last.length - 1] <= clusterGap * fps) last.push(idx);
    else clusters.push([idx]);
  }

  const moments = [];
  for (const cl of clusters) {
    let peak = cl[0];
    for (const idx of cl) {
      if (Math.abs(frames[idx].ball.x) > Math.abs(frames[peak].ball.x)) peak = idx;
    }
    const side = frames[peak].ball.x > 0 ? 1 : -1;
    const startFrame = Math.max(0, peak - Math.round(before * fps));
    const endFrame = Math.min(n - 1, cl[cl.length - 1] + Math.round(after * fps));
    const scorer = findScorer(frames, peak, fps, lookback);
    moments.push({
      startFrame,
      peakFrame: peak,
      endFrame,
      side,
      scorerId: scorer?.id ?? null,
      team: scorer?.team ?? null,
      t: frames[peak].t,
      depth: Math.abs(frames[peak].ball.x),
    });
  }

  // Drop overlapping moments, keeping the deeper (more certain) one.
  moments.sort((a, b) => b.depth - a.depth);
  const kept = [];
  for (const m of moments) {
    if (kept.some((k) => !(m.endFrame < k.startFrame || m.startFrame > k.endFrame))) continue;
    kept.push(m);
  }
  kept.sort((a, b) => a.peakFrame - b.peakFrame);
  return kept;
}

// The scorer is the player nearest the ball at any point in the ``lookback``
// seconds before the ball crosses the line (the last player to touch it).
function findScorer(frames, peak, fps, lookbackSec) {
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
