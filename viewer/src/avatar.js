import * as THREE from "three";

// Team / role palette (matches the legend in index.html).
const COLORS = {
  A: 0xe53e3e, // red
  B: 0x3182ce, // blue
  gkA: 0xf6e05e, // yellow
  gkB: 0x9f7aea, // purple
  referee: 0xed8936, // orange
};

const colorFor = (p) => {
  if (p.role === "referee") return COLORS.referee;
  if (p.role === "gk") return p.team === "A" ? COLORS.gkA : COLORS.gkB;
  return p.team === "A" ? COLORS.A : COLORS.B;
};

const TRAIL_LEN = 70; // ~1 s of render-rate samples; the player's recent path
const TRAIL_Y = 0.12; // just above the pitch so the line isn't z-fighting

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
 * Stage-1 player representation: a team-colored capsule with a facing "nose",
 * a floating jersey label, a soft ground shadow, and a fading motion trail.
 * Ball is a small white sphere.
 */
export class AvatarSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map(); // id -> handle
    this.trails = new Map(); // id -> { line, positions: number[][], color }
    this.ball = this._makeBall();
    this._lastFrame = -1;
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
    mesh.add(shadow);
    shadow.position.set(0, -0.14, 0);
    mesh.visible = false;
    return mesh;
  }

  _makeMarker() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 1.0, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 }),
    );
    body.name = "body";
    group.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(0.0, 1.4, 0);
    nose.name = "nose";
    group.add(nose);

    const labelMat = new THREE.SpriteMaterial({ depthTest: false, transparent: true });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(2.2, 2.2, 1);
    label.position.set(0, 2.6, 0);
    label.name = "label";
    group.add(label);

    // Ground shadow (flat disc just above the pitch).
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    this.scene.add(group);
    return { group, body, nose, label, shadow, currentNumber: null, currentColor: null };
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

  update(frameState) {
    // Clear trails on a seek (backward or large forward jump).
    const f = frameState.frame;
    if (this._lastFrame >= 0 && (f < this._lastFrame || f > this._lastFrame + 3)) {
      this._clearTrails();
    }
    this._lastFrame = f;

    const seen = new Set();

    for (const p of frameState.players) {
      seen.add(p.id);
      let m = this.markers.get(p.id);
      if (!m) {
        m = this._makeMarker();
        this.markers.set(p.id, m);
      }

      const h = p.height_est ?? 1.78;
      m.group.position.set(p.x, h / 2, p.z);
      m.group.rotation.y = -(p.facing ?? 0);
      m.body.scale.y = h / 1.78;

      const col = colorFor(p);
      if (m.currentColor !== col) {
        m.body.material.color.setHex(col);
        m.nose.material.color.setHex(col);
        m.currentColor = col;
      }

      const num = p.jersey?.number;
      const labelKey = num == null ? (p.role === "referee" ? "R" : "–") : String(num);
      if (m.currentNumber !== labelKey) {
        m.label.material.map = labelTexture(labelKey);
        m.label.material.needsUpdate = true;
        m.currentNumber = labelKey;
      }
      m.group.visible = true
      m.body.userData.playerId = p.id;

      // Append to trail.
      const trail = this._trailFor(p.id, col);
      trail.positions.push([p.x, TRAIL_Y, p.z]);
      if (trail.positions.length > TRAIL_LEN) trail.positions.shift();
      this._writeTrail(trail);
    }

    for (const [id, m] of this.markers) {
      if (!seen.has(id)) m.group.visible = false;
    }
    // Hide trails for ids not visible this frame (keep their buffer for resume).
    for (const [id, t] of this.trails) {
      t.line.visible = seen.has(id);
    }

    // Ball.
    const b = frameState.ball;
    if (b && b.tracked !== false) {
      this.ball.position.set(b.x, (b.y ?? 0) + 0.14, b.z);
      this.ball.visible = true;
    } else {
      this.ball.visible = false;
    }
  }

  getPickables() {
    // Body meshes (with userData.playerId) for raycasting on click.
    return Array.from(this.markers.values(), (m) => m.body);
  }

  highlight(id) {
    for (const m of this.markers.values()) {
      m.body.material.emissive?.setHex(0x000000);
    }
    if (id != null && this.markers.has(id)) {
      const m = this.markers.get(id);
      m.body.material.emissive?.setHex(0x444422);
    }
  }

  _writeTrail(trail) {    const arr = trail.positions;
    const attr = trail.line.geometry.getAttribute("position");
    for (let i = 0; i < arr.length; i++) {
      attr.setXYZ(i, arr[i][0], arr[i][1], arr[i][2]);
    }
    attr.needsUpdate = true;
    trail.line.geometry.setDrawRange(0, arr.length);
    trail.line.geometry.computeBoundingSphere();
  }
}
