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

const labelTextureCache = new Map();
function labelTexture(text) {
  if (labelTextureCache.has(text)) return labelTextureCache.get(text);
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
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
 * Stage-1 player representation: a team-colored capsule with a facing "nose"
 * and a floating jersey-number label. Ball is a small white sphere.
 */
export class AvatarSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Map(); // id -> Group
    this.ball = this._makeBall();
    scene.add(this.ball);
  }

  _makeBall() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x222222 }),
    );
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

    // Facing "nose": a small cone pointing along +X (we rotate the group by -facing).
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    nose.rotation.z = -Math.PI / 2; // point along +X
    nose.position.set(0.0, 1.4, 0);
    nose.name = "nose";
    group.add(nose);

    const labelMat = new THREE.SpriteMaterial({ depthTest: false, transparent: true });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(2.2, 2.2, 1);
    label.position.set(0, 2.6, 0);
    label.name = "label";
    group.add(label);

    this.scene.add(group);
    return { group, body, nose, label, currentNumber: null, currentColor: null };
  }

  update(frameState) {
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
      // facing = atan2(dz, dx) in pitch coords; rotate group about Y to point the +X nose.
      m.group.rotation.y = -(p.facing ?? 0);
      m.body.scale.y = h / 1.78;
      m.body.position.y = 0;

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
      m.group.visible = true;
    }

    // Hide markers not present in this frame.
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) m.group.visible = false;
    }

    // Ball.
    const b = frameState.ball;
    if (b && b.tracked !== false) {
      this.ball.position.set(b.x, (b.y ?? 0) + 0.12, b.z);
      this.ball.visible = true;
    } else {
      this.ball.visible = false;
    }
  }
}
