import * as THREE from "three";

/**
 * Build the 3D pitch: green surface + FIFA-standard line markings + lights.
 * World mapping (DESIGN section 4): world.x = u (length, ±L/2),
 * world.y = up, world.z = v (width, ±W/2). The pitch lies in the y=0 plane.
 *
 * All dimensions in meters. Standard pitch: 105 x 68.
 */
export function createScene(lengthM = 105, widthM = 68) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bb7d4);
  scene.fog = new THREE.Fog(0x9bb7d4, 160, 320);

  const halfL = lengthM / 2;
  const halfW = widthM / 2;

  // --- Pitch surface ---
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(lengthM + 12, widthM + 12),
    new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.95, metalness: 0 }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -0.02;
  scene.add(surface);

  // --- Line markings (tessellated into one LineSegments for one draw call) ---
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const segs = [];

  const pushSeg = (ax, az, bx, bz) => segs.push(ax, 0.01, az, bx, 0.01, bz);
  const pushArc = (cx, cz, r, a0, a1, steps = 48) => {
    for (let i = 0; i < steps; i++) {
      const t0 = a0 + ((a1 - a0) * i) / steps;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
      segs.push(
        cx + Math.cos(t0) * r, 0.01, cz + Math.sin(t0) * r,
        cx + Math.cos(t1) * r, 0.01, cz + Math.sin(t1) * r,
      );
    }
  };

  // Boundary + halfway line.
  pushSeg(-halfL, -halfW, halfL, -halfW);
  pushSeg(-halfL, halfW, halfL, halfW);
  pushSeg(-halfL, -halfW, -halfL, halfW);
  pushSeg(halfL, -halfW, halfL, halfW);
  pushSeg(0, -halfW, 0, halfW);

  // Center circle + spot.
  pushArc(0, 0, 9.15, 0, Math.PI * 2);
  pushSeg(-0.2, 0, 0.2, 0);
  pushSeg(0, -0.2, 0, 0.2);

  // Boxes, spots, arcs, goals — mirrored to both sides.
  for (const s of [1, -1]) {
    const goalX = s * halfL;
    // Penalty area: 16.5 deep, 40.3 wide (±20.15).
    const paX = s * (halfL - 16.5);
    pushSeg(paX, -20.15, paX, 20.15);
    pushSeg(paX, -20.15, goalX, -20.15);
    pushSeg(paX, 20.15, goalX, 20.15);
    // Goal area: 5.5 deep, 18.32 wide (±9.16).
    const gaX = s * (halfL - 5.5);
    pushSeg(gaX, -9.16, gaX, 9.16);
    pushSeg(gaX, -9.16, goalX, -9.16);
    pushSeg(gaX, 9.16, goalX, 9.16);
    // Penalty spot at 11 m.
    const psX = s * (halfL - 11);
    pushSeg(psX - 0.2, 0, psX + 0.2, 0);
    pushSeg(psX, -0.2, psX, 0.2);
    // Penalty arc (only the part outside the box, facing center).
    const aBase = s > 0 ? Math.PI : 0;
    const swing = Math.acos((halfL - 16.5 - (halfL - 11)) / 9.15); // ~acos(-5/9.15)
    pushArc(psX, 0, 9.15, aBase - (Math.PI - swing), aBase + (Math.PI - swing));
    // Goal posts (7.32 wide).
    pushSeg(goalX, -3.66, goalX, 3.66);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
  scene.add(new THREE.LineSegments(geom, lineMat));

  // --- Lights ---
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446633, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(40, 80, 30);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  return { scene, lengthM, widthM };
}
