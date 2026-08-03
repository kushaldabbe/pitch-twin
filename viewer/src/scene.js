import * as THREE from "three";

/**
 * Build the 3D match environment: gradient sky, sun + soft shadows, a grass
 * pitch with mowing stripes and FIFA line markings, a dark surround, and four
 * stands for a stadium feel. World mapping (DESIGN section 4):
 * world.x = u (length, ±L/2), world.y = up, world.z = v (width, ±W/2).
 */
export function createScene(lengthM = 105, widthM = 68) {
  const scene = new THREE.Scene();
  const skyTop = new THREE.Color(0x6ea7d6);
  const skyHorizon = new THREE.Color(0xdfe8f0);
  scene.background = skyHorizon.clone();
  scene.fog = new THREE.Fog(skyHorizon, 120, 360);

  const halfL = lengthM / 2;
  const halfW = widthM / 2;

  // --- Gradient sky dome ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: skyTop }, bottom: { value: skyHorizon } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float h = clamp(normalize(vP).y*0.6+0.4, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
    }),
  );
  scene.add(sky);

  // --- Grass pitch with mowing stripes ---
  const grass = makeGrassTexture();
  grass.repeat.set(10, 7);
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(lengthM, widthM),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0 }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.0;
  surface.receiveShadow = true;
  scene.add(surface);

  // Dark surround (the area outside the touchlines).
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(lengthM + 60, widthM + 60),
    new THREE.MeshStandardMaterial({ color: 0x1c2a1c, roughness: 1 }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.05;
  surround.receiveShadow = true;
  scene.add(surround);

  addLineMarkings(scene, halfL, halfW);

  // --- Stands (4 sides) with a crowd texture ---
  const crowd = makeCrowdTexture();
  const standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 });
  addStand(scene, [0, 8, -(halfW + 16)], [lengthM + 50, 16, 8], standMat, 0.32);
  addStand(scene, [0, 8, halfW + 16], [lengthM + 50, 16, 8], standMat, -0.32);
  addStand(scene, [-(halfL + 16), 8, 0], [8, 16, widthM + 50], standMat, 0, Math.PI / 2);
  addStand(scene, [halfL + 16, 8, 0], [8, 16, widthM + 50], standMat, 0, -Math.PI / 2);

  // --- Lighting (PBR-friendly: ACES tone mapping is set on the renderer) ---
  scene.add(new THREE.HemisphereLight(0xbfd6ea, 0x3a5a30, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
  sun.position.set(45, 90, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 250;
  const s = 80;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0002;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  return { scene, lengthM, widthM };
}

function addStand(scene, pos, size, mat, tiltX = 0, rotY = 0) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const m = new THREE.Mesh(g, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.x = tiltX;
  m.rotation.y = rotY;
  m.castShadow = false;
  m.receiveShadow = true;
  scene.add(m);
}

function makeGrassTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2f7d32";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#338335" : "#2a722e";
    ctx.fillRect(0, i * 32, 256, 32);
  }
  for (let i = 0; i < 2500; i++) {
    const g = 90 + (Math.random() * 50) | 0;
    ctx.fillStyle = `rgba(${(Math.random() * 30) | 0},${g},${(Math.random() * 30) | 0},0.18)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCrowdTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#26282b";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const r = (Math.random() * 60) | 0;
    ctx.fillStyle = `rgba(${100 + r},${90 + r},${110 + r},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addLineMarkings(scene, halfL, halfW) {
  const segs = [];
  const pushSeg = (ax, az, bx, bz) => segs.push(ax, 0.02, az, bx, 0.02, bz);
  const pushArc = (cx, cz, r, a0, a1, steps = 48) => {
    for (let i = 0; i < steps; i++) {
      const t0 = a0 + ((a1 - a0) * i) / steps;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
      segs.push(
        cx + Math.cos(t0) * r, 0.02, cz + Math.sin(t0) * r,
        cx + Math.cos(t1) * r, 0.02, cz + Math.sin(t1) * r,
      );
    }
  };

  pushSeg(-halfL, -halfW, halfL, -halfW);
  pushSeg(-halfL, halfW, halfL, halfW);
  pushSeg(-halfL, -halfW, -halfL, halfW);
  pushSeg(halfL, -halfW, halfL, halfW);
  pushSeg(0, -halfW, 0, halfW);
  pushArc(0, 0, 9.15, 0, Math.PI * 2);
  for (const sign of [1, -1]) {
    const goalX = sign * halfL;
    const paX = sign * (halfL - 16.5);
    pushSeg(paX, -20.15, paX, 20.15);
    pushSeg(paX, -20.15, goalX, -20.15);
    pushSeg(paX, 20.15, goalX, 20.15);
    const gaX = sign * (halfL - 5.5);
    pushSeg(gaX, -9.16, gaX, 9.16);
    pushSeg(gaX, -9.16, goalX, -9.16);
    pushSeg(gaX, 9.16, goalX, 9.16);
    pushSeg(goalX, -3.66, goalX, 3.66);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  scene.add(new THREE.LineSegments(geom, mat));
}
