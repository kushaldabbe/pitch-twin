import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Two switchable cameras:
 *  - tactical: fixed high broadcast-ish angle over the center spot
 *  - orbit: free OrbitControls (drag to rotate, scroll to zoom)
 * Switching eases the camera into place.
 */
export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // never dip under the pitch
    this.controls.target.set(0, 0, 0);

    this.tacticalPos = new THREE.Vector3(0, 70, 60);
    this.tacticalTarget = new THREE.Vector3(0, 0, 0);

    this.mode = "orbit";
    this.setMode("tactical");
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    if (mode === "orbit") {
      this.controls.target.copy(this.tacticalTarget);
    }
  }

  update() {
    if (this.mode === "tactical") {
      // Ease the camera toward the tactical pose for a smooth switch.
      this.camera.position.lerp(this.tacticalPos, 0.08);
      this.camera.lookAt(this.tacticalTarget);
    }
    this.controls.update();
  }
}
