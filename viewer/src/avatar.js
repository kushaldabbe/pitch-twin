import * as THREE from "three";

// Default kit palette (hex). Overridden per-clip by the `colors` block in the
// loaded JSON, whose values are [r,g,b] arrays in 0-255 sampled from the video.
const DEFAULT_KIT = {
  A: 0xd33b3b,
  B: 0x2f7ad6,
  gkA: 0xf1c40f,
  gkB: 0x9b59b6,
  referee: 0xff8c1a,
};
const SKIN = 0xe0ac8b;

const TRAIL_LEN = 70;
const TRAIL_Y = 0.12;
// The figure's forward is local +Z; pitch facing = atan2(dz, dx).
const FACING_OFFSET = Math.PI / 2;

function toColor(v) {
  if (v == null) return null;
  if (typeof v === "number") return new THREE.Color(v);
  if (Array.isArray(v)) return new THREE.Color(v[0] / 255, v[1] / 255, v[2] / 255);
  return new THREE.Color(v);
}

function shade(color, factor) {
  return color.clone().multiplyScalar(factor);
}

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
 * Stylised humanoid avatars built from primitives (no external model): skin
 * head, jersey torso, shorts, and capsule limbs that swing with speed for
 * natural idle/walk/run. Each avatar is tinted from the active clip's kit
 * palette so jerseys match the teams in the video; referees and goalkeepers
 * get distinct kits. Keeps trails, ground shadows, jersey labels, click
 * picking, and the ball.
 */
export class AvatarSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map();
    this.trails = new Map();
    this.ball = this._makeBall();
    this._lastFrame = -1;
    this.modelHeight = 1.8;
    this.kit = {}; // optional overrides from the loaded clip's `colors` block
    scene.add(this.ball);
  }

  /** Set per-clip kit colours from the JSON `colors` block. */
  setColors(colors) {
    this.kit = colors ?? {};
  }

  _kitColor(role, team) {
    return (
      toColor(this.kit[role === "gk" ? (team === "A" ? "gkA" : "gkB") : role]) ??
      new THREE.Color(DEFAULT_KIT[role === "gk" ? (team === "A" ? "gkA" : "gkB") : role])
    );
  }

  _paletteFor(p) {
    const role = p.role === "referee" ? "referee" : p.role === "gk" ? "gk" : p.team;
    const jersey = this._kitColor(p.role, p.team);
    return { jersey, shorts: shade(jersey, 0.55), skin: new THREE.Color(SKIN) };
  }

  _makeBall() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x222222 }),
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

    // Body group (raised for a subtle run bob). Limbs pivot at their joints so
    // a rotation about x swings them naturally.
    const body = new THREE.Group();
    body.position.y = 0;
    root.add(body);

    const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0 });

    const legGeo = new THREE.CapsuleGeometry(0.07, 0.5, 4, 10);
    const armGeo = new THREE.CapsuleGeometry(0.05, 0.34, 4, 10);

    // Legs pivot at the hips (y = 0.8); capsule hangs below.
    const legL = new THREE.Group(); legL.position.set(-0.1, 0.8, 0);
    const legR = new THREE.Group(); legR.position.set(0.1, 0.8, 0);
    const legLMesh = new THREE.Mesh(legGeo, mat(new THREE.Color(SKIN))); legLMesh.position.y = -0.32; legLMesh.castShadow = true;
    const legRMesh = new THREE.Mesh(legGeo, mat(new THREE.Color(SKIN))); legRMesh.position.y = -0.32; legRMesh.castShadow = true;
    legL.add(legLMesh); legR.add(legRMesh);
    body.add(legL, legR);

    // Shorts around the hips.
    const shorts = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), mat(new THREE.Color(0x222222)));
    shorts.position.y = 0.82; shorts.castShadow = true;
    body.add(shorts);

    // Jersey torso (material re-tinted per player).
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.4, 6, 12), mat(new THREE.Color(0xffffff)));
    torso.position.y = 1.22; torso.castShadow = true;
    body.add(torso);

    // Arms pivot at the shoulders (y = 1.42); capsule hangs below.
    const armL = new THREE.Group(); armL.position.set(-0.24, 1.42, 0);
    const armR = new THREE.Group(); armR.position.set(0.24, 1.42, 0);
    const armLMesh = new THREE.Mesh(armGeo, mat(new THREE.Color(SKIN))); armLMesh.position.y = -0.22; armLMesh.castShadow = true;
    const armRMesh = new THREE.Mesh(armGeo, mat(new THREE.Color(SKIN))); armRMesh.position.y = -0.22; armRMesh.castShadow = true;
    armL.add(armLMesh); armR.add(armRMesh);
    body.add(armL, armR);

    // Head.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), mat(new THREE.Color(SKIN)));
    head.position.y = 1.72; head.castShadow = true;
    body.add(head);

    return {
      root, body, label, shadow, torso, shorts,
      legL, legR, armL, armR,
      phase: Math.random() * Math.PI * 2,
      currentNumber: null, currentJersey: null,
    };
  }

  _applyKit(m, palette) {
    if (m.currentJersey === palette.jersey.getHex()) return;
    m.torso.material.color.copy(palette.jersey);
    m.shorts.material.color.copy(palette.shorts);
    m.currentJersey = palette.jersey.getHex();
  }

  _trailFor(id, colorHex) {
    let t = this.trails.get(id);
    if (!t) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      line.frustumCulled = false;
      this.scene.add(line);
      t = { line, positions: [], color: colorHex };
      this.trails.set(id, t);
    } else if (t.color !== colorHex) {
      t.line.material.color.setHex(colorHex);
      t.color = colorHex;
    }
    return t;
  }

  _clearTrails() {
    for (const t of this.trails.values()) {
      t.positions.length = 0;
      t.line.geometry.setDrawRange(0, 0);
    }
  }

  /** Remove every avatar and trail (used when the active clip changes). */
  clear() {
    for (const m of this.markers.values()) this.scene.remove(m.root);
    for (const t of this.trails.values()) this.scene.remove(t.line);
    this.markers.clear();
    this.trails.clear();
    this._lastFrame = -1;
    this.ball.visible = false;
  }

  getPickables() {
    return Array.from(this.markers.values(), (m) => m.root);
  }

  highlight(_id) {
    // Selection is shown via POV + label; no extra highlight needed.
  }

  update(st, dt = 0) {
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

      const target = -(p.facing ?? 0) + FACING_OFFSET;
      let d = ((target - m.root.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      m.root.rotation.y += d * 0.18;

      const palette = this._paletteFor(p);
      this._applyKit(m, palette);

      const num = p.jersey?.number;
      const key = num == null ? (p.role === "referee" ? "R" : "–") : String(num);
      if (m.currentNumber !== key) {
        m.label.material.map = labelTexture(key);
        m.label.material.needsUpdate = true;
        m.currentNumber = key;
      }
      m.root.visible = true;

      // Procedural locomotion: cadence and amplitude rise with speed.
      const sp = p.speed ?? 0;
      m.phase += (dt || 0.016) * (1.6 + sp * 1.1);
      const amp = sp < 0.6 ? 0.0 : sp < 3.2 ? 0.35 : 0.85;
      const swing = Math.sin(m.phase) * amp;
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      m.armL.rotation.x = -swing * 0.8;
      m.armR.rotation.x = swing * 0.8;
      m.body.position.y = Math.abs(Math.sin(m.phase)) * 0.03 * (amp > 0 ? 1 : 0);

      const trail = this._trailFor(p.id, palette.jersey.getHex());
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
