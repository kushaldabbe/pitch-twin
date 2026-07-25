import * as THREE from "three";
import { createScene } from "./scene.js";
import { AvatarSystem } from "./avatar.js";
import { CameraRig } from "./camera.js";
import { Replay } from "./replay.js";

const SAMPLE_URL = "./sample.json";

async function loadData() {
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) throw new Error(`Failed to load ${SAMPLE_URL}: ${res.status}`);
  return res.json();
}

function formatTime(t) {
  return `${t.toFixed(1)}s`;
}

async function main() {
  const data = await loadData();
  const replay = new Replay(data);
  const { scene } = createScene(replay.lengthM, replay.widthM);

  const app = document.getElementById("app");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 70, 60);

  const rig = new CameraRig(camera, renderer.domElement);
  const avatars = new AvatarSystem(scene);

  // --- UI wiring ---
  const playBtn = document.getElementById("play");
  const scrub = document.getElementById("scrub");
  const timeEl = document.getElementById("time");
  const speedSel = document.getElementById("speed");
  const camSel = document.getElementById("camera");
  const statusEl = document.getElementById("status");

  scrub.max = replay.frameCount > 0 ? replay.frameCount - 1 : 0;

  playBtn.addEventListener("click", () => {
    const playing = replay.togglePlay();
    playBtn.textContent = playing ? "Pause" : "Play";
  });

  scrub.addEventListener("input", () => {
    const idx = Number(scrub.value);
    const frac = replay.frameCount > 1 ? idx / (replay.frameCount - 1) : 0;
    replay.seekFraction(frac);
  });

  speedSel.addEventListener("change", () => replay.setSpeed(Number(speedSel.value)));
  camSel.addEventListener("change", () => {
    rig.setMode(camSel.value);
    flashStatus(camSel.value === "tactical" ? "tactical camera" : "drag to orbit · scroll to zoom");
  });

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
  flashStatus("drag to orbit · switch camera below");

  // --- Render loop ---
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    replay.update(dt);

    const st = replay.state();
    avatars.update(st);

    // Keep scrubber + time in sync during playback.
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
    `<h2>Failed to start PitchTwin viewer</h2><pre>${err.message}</pre>` +
    `<p>Did you generate the sample? Run:` +
    `<code> python -m pitchtwin.contract.synthetic --out data/sample_clip/synthetic.json</code></p></div>`;
});
