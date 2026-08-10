import * as THREE from "three";
import { createScene } from "./scene.js";
import { AvatarSystem } from "./avatar.js";
import { CameraRig } from "./camera.js";
import { Replay } from "./replay.js";

const CLIPS_URL = "./clips.json";
const clipUrl = (id) => `./clips/${id}.json`;

function formatTime(t) {
  return `${t.toFixed(1)}s`;
}

async function main() {
  // --- 3D layer (built once, reused across clips) ---
  const app = document.getElementById("app");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 30, 64);

  const { scene } = createScene(105, 68, renderer);
  const rig = new CameraRig(camera, renderer.domElement);
  const avatars = new AvatarSystem(scene);

  // --- UI wiring ---
  const clipSel = document.getElementById("clip");
  const playBtn = document.getElementById("play");
  const scrub = document.getElementById("scrub");
  const timeEl = document.getElementById("time");
  const speedSel = document.getElementById("speed");
  const camSel = document.getElementById("camera");
  const statusEl = document.getElementById("status");

  let replay = null;
  let selectedId = null;
  let currentClipId = null;
  const clipIds = [];

  playBtn.addEventListener("click", () => {
    const playing = replay?.togglePlay();
    playBtn.textContent = playing ? "Pause" : "Play";
  });

  scrub.addEventListener("input", () => {
    if (!replay) return;
    const idx = Number(scrub.value);
    const frac = replay.frameCount > 1 ? idx / (replay.frameCount - 1) : 0;
    replay.seekFraction(frac);
  });

  speedSel.addEventListener("change", () => replay?.setSpeed(Number(speedSel.value)));

  camSel.addEventListener("change", () => {
    rig.setMode(camSel.value);
    const msg = {
      broadcast: "broadcast camera",
      tactical: "tactical (coach) camera",
      orbit: "drag to orbit · scroll to zoom",
      pov: selectedId == null ? "POV: click a player" : `POV: player #${selectedId}`,
    }[camSel.value];
    flashStatus(msg);
  });

  // --- Click a player to drop into their POV ---
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  renderer.domElement.addEventListener("click", (event) => {
    if (!replay) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(avatars.getPickables(), true);
    let hitId = null;
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.userData.playerId === undefined) o = o.parent;
      hitId = o ? o.userData.playerId : null;
    }
    if (hitId != null) {
      selectedId = hitId;
      rig.setMode("pov");
      camSel.value = "pov";
      avatars.highlight(selectedId);
      flashStatus(`POV: player #${selectedId} — click empty pitch to exit`);
    } else {
      selectedId = null;
      avatars.highlight(null);
      rig.setMode("broadcast");
      camSel.value = "broadcast";
      flashStatus("broadcast camera");
    }
  });

  // --- Clip selection ---
  clipSel.addEventListener("change", () => {
    const id = clipSel.value;
    if (id && id !== currentClipId) window.location.hash = `clip=${id}`;
  });
  window.addEventListener("hashchange", () => {
    const id = hashClipId();
    if (id && id !== currentClipId && clipIds.includes(id)) loadClip(id);
  });

  function hashClipId() {
    const m = window.location.hash.match(/clip=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function loadClip(id) {
    currentClipId = id;
    clipSel.value = id;
    let data;
    try {
      const res = await fetch(clipUrl(id));
      if (!res.ok) throw new Error(`Failed to load ${id}: ${res.status}`);
      data = await res.json();
    } catch (err) {
      showError(err);
      return;
    }
    playClip(data);
    flashStatus(`loaded: ${clipSel.options[clipSel.selectedIndex]?.text ?? id}`);
  }

  function playClip(data) {
    avatars.clear();
    avatars.setColors(data.colors);
    selectedId = null;
    replay = new Replay(data);
    rig.setMode("broadcast");
    camSel.value = "broadcast";
    scrub.max = replay.frameCount > 0 ? replay.frameCount - 1 : 0;
    scrub.value = 0;
    playBtn.textContent = "Play";
    timeEl.textContent = formatTime(0);
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let statusTimer = null;
  function flashStatus(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("show"), 1800);
  }

  function showError(err) {
    console.error(err);
    app.innerHTML =
      `<div style="color:#fff;padding:24px;font-family:sans-serif">` +
      `<h2>Failed to start PitchTwin viewer</h2><pre>${err.message}</pre></div>`;
  }

  // --- Load the clip index, then the initial clip ---
  let clips;
  try {
    const res = await fetch(CLIPS_URL);
    if (!res.ok) throw new Error(`Failed to load clip index: ${res.status}`);
    clips = await res.json();
  } catch (err) {
    showError(err);
    return;
  }
  if (!Array.isArray(clips) || clips.length === 0) {
    showError(new Error("No clips found. Run the pipeline to generate one."));
    return;
  }
  for (const c of clips) {
    clipIds.push(c.id);
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    clipSel.appendChild(opt);
  }
  flashStatus("click any player for their POV · switch camera below");

  const initial = hashClipId();
  await loadClip(clipIds.includes(initial) ? initial : clipIds[0]);

  // --- Render loop ---
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!replay) return;
    replay.update(dt);

    const st = replay.state();
    avatars.update(st, dt);

    if (selectedId != null) {
      const sel = st.players.find((p) => p.id === selectedId);
      if (sel) {
        const ball =
          st.ball && st.ball.tracked !== false ? { x: st.ball.x, z: st.ball.z } : null;
        rig.setPovTarget({
          px: sel.x,
          pz: sel.z,
          height: sel.height_est,
          ball,
          facing: sel.facing,
        });
      }
    }

    if (replay.duration > 0) {
      scrub.value = Math.round((replay.t / replay.duration) * (replay.frameCount - 1));
    }
    timeEl.textContent = formatTime(replay.t);

    rig.update();
    renderer.render(scene, camera);
  }
  animate();
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  app.innerHTML =
    `<div style="color:#fff;padding:24px;font-family:sans-serif">` +
    `<h2>Failed to start PitchTwin viewer</h2><pre>${err.message}</pre></div>`;
});
