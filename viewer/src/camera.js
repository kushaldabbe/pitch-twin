import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Fixed camera poses (eased into when selected). Orbit is free-form.
const POSES = {
  broadcast: { pos: new THREE.Vector3(0, 30, 64), target: new THREE.Vector3(0, 0, 0) },
  tactical: { pos: new THREE.Vector3(0, 78, 52), target: new THREE.Vector3(0, 0, 0) },
};

/**
 * Switchable cameras:
 *  - broadcast: a TV-ish high-sideline angle (default; reads better than top-down)
 *  - tactical:  fixed high top-down (the coach view)
 *  - orbit:     free OrbitControls (drag to rotate, scroll to zoom)
 */
export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // never dip under the pitch
    this.controls.target.set(0, 0, 0);

    this.mode = "orbit";
    this.setMode("broadcast");
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    if (mode === "orbit") {
      this.controls.target.set(0, 0, 0);
    }
  }

  update() {
    if (this.mode !== "orbit") {
      const pose = POSES[this.mode] ?? POSES.broadcast;
      this.camera.position.lerp(pose.pos, 0.08);
      this.camera.lookAt(pose.target);
    }
    this.controls.update();
  }
}
