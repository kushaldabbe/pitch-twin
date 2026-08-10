import * as THREE from "three";

// Default kit palette (hex). Overridden per clip by the `colors` block in the
// loaded JSON (values are [r,g,b] arrays in 0-255 sampled from the video).
const DEFAULT_KIT = {
  A: 0xd33b3b,
  B: 0x2f7ad6,
  gkA: 0xf1c40f,
  gkB: 0x9b59b6,
  referee: 0xff8c1a,
};
const SKIN = 0xe3b58f;
const SHOE = 0x1a1a1a;

const TRAIL_LEN = 70;
const TRAIL_Y = 0.12;
// The figure's forward is local +Z; pitch facing = atan2(dz, dx).
const FACING_OFFSET = Math.PI / 2;
const MODEL_HEIGHT = 1.8;

function toColor(v) {
  if (v == null) return null;
  if (typeof v === "number") return new THREE.Color(v);
  if (Array.isArray(v)) return new THREE.Color(v[0] / 255, v[1] / 255, v[2] / 255);
  return new THREE.Color(v);
}
const shade = (c, f) => c.clone().multiplyScalar(f);

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

// Shared geometries (smooth-shaded, enough segments so nothing reads as blocky).
const GEO = {
  thigh: new THREE.CapsuleGeometry(0.085, 0.34, 8, 14),
  shin: new THREE.CapsuleGeometry(0.06, 0.34, 8, 14),
  upperArm: new THREE.CapsuleGeometry(0.05, 0.26, 8, 12),
  foreArm: new THREE.CapsuleGeometry(0.04, 0.24, 8, 12),
  hand: new THREE.SphereGeometry(0.055, 14, 12),
  torso: new THREE.CylinderGeometry(0.135, 0.18, 0.5, 18, 4),
  hip: new THREE.SphereGeometry(0.18, 18, 14),
  neck: new THREE.CylinderGeometry(0.055, 0.06, 0.09, 12),
  head: new THREE.SphereGeometry(0.135, 20, 18),
  foot: new THREE.BoxGeometry(0.1, 0.07, 0.22),
};

/**
 * Stylised but smooth humanoid avatars: rounded/tapered geometry (no boxes for
 * the body), two-segment legs with knee bends and arms with elbows, hip sway,
 * forward lean, and a vertical bob. Gait cadence and amplitude scale with the
 * (smoothed) speed so idle/walk/run blend continuously. Jerseys, shorts, socks,
 * and shoes are separate materials, tinted from each clip's detected kit
 * palette so jerseys match the teams in the video; referees and goalkeepers get
 * distinct kits. Keeps trails, ground shadows, jersey labels, picking, ball.
 */
export class AvatarSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map();
    this.trails = new Map();
    this.ball = this._makeBall();
    this._lastFrame = -1;
    this.kit = {};
    scene.add(this.ball);
  }

  setColors(colors) {
    this.kit = colors ?? {};
  }

  _kitColor(role, team) {
    const key = role === "referee" ? "referee" : role === "gk" ? (team === "A" ? "gkA" : "gkB") : team;
    return toColor(this.kit[key]) ?? new THREE.Color(DEFAULT_KIT[key]);
  }

  _paletteFor(p) {
    const jersey = this._kitColor(p.role, p.team);
    return {
      jersey,
      shorts: shade(jersey, 0.5),
      socks: shade(jersey, 0.85),
      skin: new THREE.Color(SKIN),
      shoe: new THREE.Color(SHOE),
    };
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

  _material(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.0 });
  }

  _limb(geom, mat, length, pivotY) {
    const pivot = new THREE.Group();
    pivot.position.y = pivotY;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = -length / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return { pivot, mesh };
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
    label.position.set(0, 2.15, 0);
    root.add(label);
    this.scene.add(root);

    // Body group carries the bob/sway/lean without affecting facing on root.
    const body = new THREE.Group();
    root.add(body);

    const mats = {
      jersey: this._material(new THREE.Color(0xffffff)),
      shorts: this._material(new THREE.Color(0x222222)),
      socks: this._material(new THREE.Color(0xffffff)),
      skin: this._material(new THREE.Color(SKIN)),
      shoe: this._material(new THREE.Color(SHOE)),
    };

    // Legs: hip pivot -> thigh -> knee pivot -> shin -> foot.
    const legs = [];
    for (const sx of [-0.09, 0.09]) {
      const hip = new THREE.Group();
      hip.position.set(sx, 0.82, 0);
      const thigh = new THREE.Mesh(GEO.thigh, mats.skin);
      thigh.position.y = -0.21; thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = new THREE.Mesh(GEO.shin, mats.socks);
      shin.position.y = -0.2; shin.castShadow = true;
      knee.add(shin);
      const foot = new THREE.Mesh(GEO.foot, mats.shoe);
      foot.position.set(0, -0.4, 0.05); foot.castShadow = true;
      knee.add(foot);
      body.add(hip);
      legs.push({ hip, knee });
    }

    // Rounded hips / shorts.
    const hips = new THREE.Mesh(GEO.hip, mats.shorts);
    hips.position.y = 0.84; hips.scale.set(1, 0.8, 1); hips.castShadow = true;
    body.add(hips);

    // Tapered jersey torso.
    const torso = new THREE.Mesh(GEO.torso, mats.jersey);
    torso.position.y = 1.2; torso.castShadow = true;
    body.add(torso);

    // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> hand.
    const arms = [];
    for (const sx of [-0.21, 0.21]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx, 1.4, 0);
      const upper = new THREE.Mesh(GEO.upperArm, mats.skin);
      upper.position.y = -0.16; upper.castShadow = true;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(GEO.foreArm, mats.skin);
      fore.position.y = -0.14; fore.castShadow = true;
      elbow.add(fore);
      const hand = new THREE.Mesh(GEO.hand, mats.skin);
      hand.position.y = -0.28; hand.castShadow = true;
      elbow.add(hand);
      body.add(shoulder);
      arms.push({ shoulder, elbow });
    }

    // Neck + head.
    const neck = new THREE.Mesh(GEO.neck, mats.skin);
    neck.position.y = 1.48; neck.castShadow = true;
    body.add(neck);
    const head = new THREE.Mesh(GEO.head, mats.skin);
    head.position.y = 1.62; head.scale.set(1, 1.12, 1); head.castShadow = true;
    body.add(head);

    return {
      root, body, label, shadow, torso, hips, legs, arms, mats,
      phase: Math.random() * Math.PI * 2,
      speed: 0,
      currentNumber: null,
      currentJersey: null,
    };
  }

  _applyKit(m, pal) {
    const hex = pal.jersey.getHex();
    if (m.currentJersey === hex) return;
    m.mats.jersey.color.copy(pal.jersey);
    m.mats.shorts.color.copy(pal.shorts);
    m.mats.socks.color.copy(pal.socks);
    m.currentJersey = hex;
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

  highlight(_id) {}

  update(st, dt = 0) {
    const f = st.frame;
    if (this._lastFrame >= 0 && (f < this._lastFrame || f > this._lastFrame + 3)) this._clearTrails();
    this._lastFrame = f;
    const h = dt || 0.016;

    const seen = new Set();
    for (const p of st.players) {
      seen.add(p.id);
      let m = this.markers.get(p.id);
      if (!m) {
        m = this._makeMarker();
        this.markers.set(p.id, m);
      }

      const heightEst = p.height_est ?? 1.78;
      m.root.position.set(p.x, 0.0, p.z);
      m.root.scale.setScalar(heightEst / MODEL_HEIGHT);
      m.root.userData.playerId = p.id;

      const target = -(p.facing ?? 0) + FACING_OFFSET;
      let d = ((target - m.root.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      m.root.rotation.y += d * 0.18;

      this._applyKit(m, this._paletteFor(p));

      const num = p.jersey?.number;
      const key = num == null ? (p.role === "referee" ? "R" : "–") : String(num);
      if (m.currentNumber !== key) {
        m.label.material.map = labelTexture(key);
        m.label.material.needsUpdate = true;
        m.currentNumber = key;
      }
      m.root.visible = true;

      // Smooth the reported speed so the gait does not twitch frame to frame.
      m.speed += (((p.speed ?? 0) - m.speed) * Math.min(1, h * 6));
      const sp = m.speed;

      // Cadence and amplitude rise with speed; idle blends to a gentle sway.
      const mov = Math.min(1, sp / 5);                     // 0 idle .. 1 sprint
      const active = sp > 0.6 ? 1 : sp / 0.6;               // gate idle vs moving
      m.phase += h * (2.2 + sp * 1.3);
      const ampHip = (0.15 + 0.55 * mov) * active;
      const ampKnee = (0.5 + 0.9 * mov) * active;
      const ampArm = (0.25 + 0.6 * mov) * active;
      const bobAmp = (0.015 + 0.04 * mov) * active;
      const swayAmp = (0.02 + 0.05 * mov) * active;

      for (let i = 0; i < 2; i++) {        const q = m.phase + i * Math.PI;                   // legs are half-cycle apart
        const leg = m.legs[i];
        leg.hip.rotation.x = Math.sin(q) * ampHip;
        // Knee bends during the swing/recovery (foot moving forward+up).
        leg.knee.rotation.x = Math.max(0, Math.sin(q + 1.1)) * ampKnee + 0.05 * active;
        const arm = m.arms[1 - i];                         // arms counter the legs
        arm.shoulder.rotation.x = -Math.sin(q) * ampArm;
        arm.elbow.rotation.x = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(q + 1.4))) * active + 0.12 * active;
      }

      // Vertical bob (two per stride), hip sway, slight forward lean.
      m.body.position.y = Math.abs(Math.sin(m.phase)) * bobAmp;
      m.body.rotation.z = Math.sin(m.phase) * swayAmp;
      m.body.rotation.x = 0.1 * active + Math.sin(m.phase * 2) * 0.015 * active;
      // Idle breathing when not moving.
      if (active < 1) {
        m.body.position.y += Math.sin(m.phase * 0.5) * 0.01 * (1 - active);
      }

      const trail = this._trailFor(p.id, this._paletteFor(p).jersey.getHex());
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
