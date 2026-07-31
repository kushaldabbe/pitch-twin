import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Fixed camera poses (eased into when selected). Orbit is free-form.
const POSES = {
  broadcast: { pos: new THREE.Vector3(0, 30, 64), target: new THREE.Vector3(0, 0, 0) },
  tactical: { pos: new THREE.Vector3(0, 78, 52), target: new THREE.Vector3(0, 0, 0) },
};

const EYE_RATIO = 0.92;     // camera height vs player height_est
const POV_LOOK_AHEAD = 12;  // meters ahead to aim
const POV_LOOK_DROP = 1.8;  // look slightly down to see the pitch ahead

/**
 * Switchable cameras:
 *  - broadcast: a TV-ish high-sideline angle (default)
 *  - tactical:  fixed high top-down (the coach view)
 *  - orbit:     free OrbitControls (drag to rotate, scroll to zoom)
 *  - pov:       first-person from the selected player's head, looking where he faces
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
    this.povTarget = null; // {x, z, facing, height}
    this._look = new THREE.Vector3();
    this.setMode("broadcast");
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    if (mode === "orbit") {
      this.controls.target.set(0, 0, 0);
    }
  }

  setPovTarget(target) {
    this.povTarget = target;
  }

  update() {
    if (this.mode === "pov" && this.povTarget) {
      const { x, z, facing, height } = this.povTarget;
      const eye = (height ?? 1.78) * EYE_RATIO;
      this.camera.position.set(x, eye, z);
      // facing = atan2(dz, dx); nose cone already uses (cos f, 0, sin f).
      this._look.set(
        x + Math.cos(facing) * POV_LOOK_AHEAD,
        eye - POV_LOOK_DROP,
        z + Math.sin(facing) * POV_LOOK_AHEAD,
      );
      this.camera.lookAt(this._look);
    } else if (this.mode !== "orbit") {
      const pose = POSES[this.mode] ?? POSES.broadcast;
      this.camera.position.lerp(pose.pos, 0.08);
      this.camera.lookAt(pose.target);
    }
    this.controls.update();
  }
}

