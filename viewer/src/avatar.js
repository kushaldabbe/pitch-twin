import * as THREE from "three";

// Team / role palette (matches the legend in index.html).
const COLORS = {
  A: 0xe53e3e,
  B: 0x3182ce,
  gkA: 0xf6e05e,
  gkB: 0x9f7aea,
  referee: 0xed8936,
  skin: 0xe0ac69,
  dark: 0x202020,
};

const colorFor = (p) => {
  if (p.role === "referee") return COLORS.referee;
  if (p.role === "gk") return p.team === "A" ? COLORS.gkA : COLORS.gkB;
  return p.team === "A" ? COLORS.A : COLORS.B;
};

const TRAIL_LEN = 70;
const TRAIL_Y = 0.12;
const STRIDE_FREQ = 2.2;   // stride rate scaling with speed
const MAX_SPEED = 8.0;     // for normalizing stride amplitude

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

function makeLimb(radius, length, color) {
  // Pivot at the top; the capsule hangs downward from y=0.
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  mesh.castShadow = true;
  mesh.position.y = -(length / 2 + radius);
  pivot.add(mesh);
  return pivot;
}

/**
 * Stage-2 player avatar: a procedural humanoid that runs a stride cycle driven
 * by speed, orients by facing, and scales to height_est. Jerseys/shadows/trails
 * and click-picking are preserved. (Upgrade path: swap the procedural body for a
 * rigged GLB driven by the body-pose keypoints.)
 */
export class AvatarSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map();
    this.trails = new Map();
    this.ball = this._makeBall();
    this._lastFrame = -1;
    this.time = 0;
    scene.add(this.ball);
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

    // Figure (built ~1.78 m tall; scaled at update time).
    const figure = new THREE.Group();
    const jersey = colorFor({ team: "A", role: "player" });

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.16, 0.55, 10),
      new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.7 }),
    );
    torso.castShadow = true;
    torso.position.y = 1.18;
    figure.add(torso);

    const hips = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.14, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.7 }),
    );
    hips.castShadow = true;
    hips.position.y = 0.88;
    figure.add(hips);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 14, 14),
      new THREE.MeshStandardMaterial({ color: COLORS.skin, roughness: 0.8 }),
    );
    head.castShadow = true;
    head.position.y = 1.62;
    figure.add(head);

    const lArm = makeLimb(0.055, 0.5, jersey); lArm.position.set(-0.24, 1.45, 0); figure.add(lArm);
    const rArm = makeLimb(0.055, 0.5, jersey); rArm.position.set(0.24, 1.45, 0); figure.add(rArm);
    const lLeg = makeLimb(0.075, 0.7, COLORS.dark); lLeg.position.set(-0.1, 0.85, 0); figure.add(lLeg);
    const rLeg = makeLimb(0.075, 0.7, COLORS.dark); rLeg.position.set(0.1, 0.85, 0); figure.add(rLeg);

    // A faint "nose" cone so facing is visible (kept from Stage 1).
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.25, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.18, 0.22);
    figure.add(nose);

    root.add(figure);

    // Ground shadow.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);

    // Floating jersey-number label.
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    label.scale.set(2.2, 2.2, 1);
    label.position.set(0, 2.2, 0);
    root.add(label);

    this.scene.add(root);
    return {
      root, figure, torso, head, nose, label, shadow, lArm, rArm, lLeg, rLeg,
      currentNumber: null, currentColor: null, phase: Math.random() * Math.PI * 2,
    };
  }

  _setJerseyColor(m, col) {
    m.torso.material.color.setHex(col);
    m.lArm.children[0].material.color.setHex(col);
    m.rArm.children[0].material.color.setHex(col);
    m.nose.material.color.setHex(col);
  }

  _trailFor(id, color) {
    let t = this.trails.get(id);
    if (!t) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false });
      const line = new THREE.Line(geom, mat);
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
    return Array.from(this.markers.values(), (m) => m.torso);
  }

  highlight(id) {
    for (const m of this.markers.values()) {
      m.torso.material.emissive?.setHex(0x000000);
    }
    if (id != null && this.markers.has(id)) {
      this.markers.get(id).torso.material.emissive?.setHex(0x553333);
    }
  }

  update(st, dt = 0) {
    this.time += dt;
    const f = st.frame;
    if (this._lastFrame >= 0 && (f < this._lastFrame || f > this._lastFrame + 3)) {
      this._clearTrails();
    }
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
      // Smooth the facing toward the target (shortest arc) -- kills jitter from
      // noisy body-pose facing and frame interpolation.
      const targetFac = -(p.facing ?? 0);
      let d = ((targetFac - m.root.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      m.root.rotation.y += d * 0.18;
      m.root.scale.setScalar(h / 1.78);
      m.torso.userData.playerId = p.id;

      const col = colorFor(p);
      if (m.currentColor !== col) {
        this._setJerseyColor(m, col);
        m.currentColor = col;
      }

      // Stride animation: amplitude scales with speed; idle sway when still.
      const speed = p.speed ?? 0;
      const amp = Math.min(1, speed / MAX_SPEED);
      m.phase += (dt || 0.016) * (2 + speed * STRIDE_FREQ);
      const swing = Math.sin(m.phase) * amp * 0.9;
      m.lLeg.rotation.x = swing;
      m.rLeg.rotation.x = -swing;
      m.lArm.rotation.x = -swing * 0.8;
      m.rArm.rotation.x = swing * 0.8;
      m.figure.position.y = amp * Math.abs(Math.sin(m.phase)) * 0.06; // slight run bob
      if (amp < 0.08) {
        // idle: gentle breathing sway
        m.figure.rotation.z = Math.sin(this.time * 1.5 + m.phase) * 0.02;
      } else {
        m.figure.rotation.z = 0;
      }

      const num = p.jersey?.number;
      const labelKey = num == null ? (p.role === "referee" ? "R" : "–") : String(num);
      if (m.currentNumber !== labelKey) {
        m.label.material.map = labelTexture(labelKey);
        m.label.material.needsUpdate = true;
        m.currentNumber = labelKey;
      }
      m.root.visible = true;

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

    for (const [id, m] of this.markers) {
      if (!seen.has(id)) m.root.visible = false;
    }
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
