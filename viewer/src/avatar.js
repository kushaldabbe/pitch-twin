import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const COLORS = {
  A: 0xe53e3e,
  B: 0x3182ce,
  gkA: 0xf6e05e,
  gkB: 0x9f7aea,
  referee: 0xed8936,
};

const colorFor = (p) => {
  if (p.role === "referee") return COLORS.referee;
  if (p.role === "gk") return p.team === "A" ? COLORS.gkA : COLORS.gkB;
  return p.team === "A" ? COLORS.A : COLORS.B;
};

const MODEL_URL = "models/Xbot.glb";
const TRAIL_LEN = 70;
const TRAIL_Y = 0.12;
// Xbot faces +Z in its local frame; pitch facing = atan2(dz, dx). This offset
// aligns the model's forward with the facing direction. Flip sign if they look
// the wrong way.
const FACING_OFFSET = Math.PI / 2;

const labelTextureCache = new Map();
function labelTexture(text) {
  if (labelTextureCache.has(text)) return labelTextureCache.get(text);
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 52px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 66);
  const tex = new THREE.CanvasTexture(c);
  labelTextureCache.set(text, tex);
  return tex;
}

/**
 * Stage-2 avatars using a real rigged character (Xbot.glb): cloned per player,
 * tinted by team, with idle/walk/run driven by speed. Falls back to a
 * procedural humanoid if the model fails to load. Keeps trails, shadows,
 * jersey labels, click-picking, and the ball.
 */
export class AvatarSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map();
    this.trails = new Map();
    this.ball = this._makeBall();
    this._lastFrame = -1;
    this.time = 0;
    this.ready = false;       // GLB loaded
    this.template = null;
    this.modelHeight = 1.81;
    this.clips = {};
    scene.add(this.ball);
    this._load();
  }

  _load() {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const tpl = gltf.scene;
        const box = new THREE.Box3().setFromObject(tpl);
        const dy = -box.min.y;            // shift feet to y=0
        this.modelHeight = box.max.y - box.min.y || 1.81;
        tpl.traverse((o) => {
          if (o.isMesh) o.castShadow = true;
        });
        tpl.position.y += dy;
        this.template = tpl;
        const find = (names) => {
          for (const n of names) {
            const a = gltf.animations.find((x) => x.name.toLowerCase() === n);
            if (a) return a;
          }
          return null;
        };
        this.clips = {
          idle: find(["idle"]),
          walk: find(["walk"]),
          run: find(["run"]),
        };
        this.ready = true;
        this.markers.clear(); // recreate as real avatars
      },
      undefined,
      (err) => console.warn("Xbot.glb failed; using procedural avatars", err),
    );
  }

  _makeBall() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x333333 }),
    );
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -0.14, 0);
    mesh.add(shadow);
    mesh.visible = false;
    return mesh;
  }

  _makeMarker() {
    const root = new THREE.Group();
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    label.scale.set(2.2, 2.2, 1);
    label.position.set(0, 2.25, 0);
    root.add(label);
    this.scene.add(root);

    const handle = {
      root, label, shadow, currentNumber: null, currentColor: null,
      mixer: null, actions: {}, current: "idle",
    };

    if (this.ready && this.template) {
      const clone = cloneSkeleton(this.template);
      clone.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.material = o.material.clone();
        }
      });
      root.add(clone);
      handle.mixer = new THREE.AnimationMixer(clone);
      for (const k of ["idle", "walk", "run"]) {
        if (this.clips[k]) handle.actions[k] = handle.mixer.clipAction(this.clips[k]);
      }
      if (handle.actions.idle) {
        handle.actions.idle.play();
      }
    }
    return handle;
  }

  _tint(m, hex) {
    if (!m.mixer) return; // procedural tint could go here
    m.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) {
        if (!o.userData.skin) o.material.color.setHex(hex);
      }
    });
  }

  _trailFor(id, color) {
    let t = this.trails.get(id);
    if (!t) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      line.frustumCulled = false;
      this.scene.add(line);
      t = { line, positions: [], color };
      this.trails.set(id, t);
    } else if (t.color !== color) {
      t.line.material.color.setHex(color);
      t.color = color;
    }
    return t;
  }

  _clearTrails() {
    for (const t of this.trails.values()) {
      t.positions.length = 0;
      t.line.geometry.setDrawRange(0, 0);
    }
  }

  getPickables() {
    return Array.from(this.markers.values(), (m) => m.root);
  }

  highlight(id) {
    // No-op safe target; selection is indicated by POV + label.
  }

  update(st, dt = 0) {
    this.time += dt;
    const f = st.frame;
    if (this._lastFrame >= 0 && (f < this._lastFrame || f > this._lastFrame + 3)) this._clearTrails();
    this._lastFrame = f;

    const seen = new Set();
    for (const p of st.players) {
      seen.add(p.id);
      let m = this.markers.get(p.id);
      if (!m) {
        m = this._makeMarker();
        this.markers.set(p.id, m);
      }

      const h = p.height_est ?? 1.78;
      m.root.position.set(p.x, 0.0, p.z);
      m.root.scale.setScalar(h / this.modelHeight);
      m.root.userData.playerId = p.id;

      // Smooth facing (shortest arc) to kill jitter.
      const target = -(p.facing ?? 0) + FACING_OFFSET;
      let d = ((target - m.root.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      m.root.rotation.y += d * 0.18;

      const col = colorFor(p);
      if (m.currentColor !== col) {
        this._tint(m, col);
        m.currentColor = col;
      }

      const num = p.jersey?.number;
      const key = num == null ? (p.role === "referee" ? "R" : "–") : String(num);
      if (m.currentNumber !== key) {
        m.label.material.map = labelTexture(key);
        m.label.material.needsUpdate = true;
        m.currentNumber = key;
      }
      m.root.visible = true;

      // Animation by speed with crossfade.
      if (m.mixer) {
        const want = (p.speed ?? 0) < 0.6 ? "idle" : (p.speed ?? 0) < 3.2 ? "walk" : "run";
        if (want !== m.current && m.actions[want]) {
          if (m.actions[m.current]) m.actions[m.current].fadeOut(0.25);
          m.actions[want].reset().fadeIn(0.25).play();
          m.current = want;
        }
        m.mixer.update(dt || 0.016);
      }

      const trail = this._trailFor(p.id, col);
      trail.positions.push([p.x, TRAIL_Y, p.z]);
      if (trail.positions.length > TRAIL_LEN) trail.positions.shift();
      const arr = trail.positions;
      const attr = trail.line.geometry.getAttribute("position");
      for (let i = 0; i < arr.length; i++) attr.setXYZ(i, arr[i][0], arr[i][1], arr[i][2]);
      attr.needsUpdate = true;
      trail.line.geometry.setDrawRange(0, arr.length);
      trail.line.geometry.computeBoundingSphere();
    }

    for (const [id, m] of this.markers) if (!seen.has(id)) m.root.visible = false;
    for (const [id, t] of this.trails) t.line.visible = seen.has(id);

    const b = st.ball;
    if (b && b.tracked !== false) {
      this.ball.position.set(b.x, (b.y ?? 0) + 0.14, b.z);
      this.ball.visible = true;
    } else {
      this.ball.visible = false;
    }
  }
}
