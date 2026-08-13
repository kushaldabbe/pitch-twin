import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Fixed camera poses (eased into when selected). Orbit is free-form.
const POSES = {
  broadcast: { pos: new THREE.Vector3(0, 30, 64), target: new THREE.Vector3(0, 0, 0) },
  tactical: { pos: new THREE.Vector3(0, 78, 52), target: new THREE.Vector3(0, 0, 0) },
};

const EYE_RATIO = 0.92;     // camera height vs player height_est
const POV_LOOK_AHEAD = 12;  // meters ahead to aim (used when no ball)
const POV_LOOK_DROP = 1.8;  // look slightly down to see the pitch ahead
const POV_BALL_Y = 0.5;     // aim at the ball at a low height so the pitch ahead is visible

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
    this.povTarget = null; // {px, pz, height, ball: {x,z}|null, facing}
    this.scoreTarget = null; // {px, pz, facing, ball: {x,z}|null}
    this._look = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
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

  setScoreTarget(target) {
    this.scoreTarget = target;
  }

  update() {
    if (this.mode === "pov" && this.povTarget) {
      const { px, pz, height, ball, facing } = this.povTarget;
      const eye = (height ?? 1.78) * EYE_RATIO;
      this.camera.position.set(px, eye, pz);
      if (ball) {
        // Players look at the ball most of the time -- aim at it.
        this._look.set(ball.x, POV_BALL_Y, ball.z);
      } else {
        // No ball in view: fall back to the body/velocity facing.
        this._look.set(
          px + Math.cos(facing) * POV_LOOK_AHEAD,
          eye - POV_LOOK_DROP,
          pz + Math.sin(facing) * POV_LOOK_AHEAD,
        );
      }
      this.camera.lookAt(this._look);
    } else if (this.mode === "scorecam" && this.scoreTarget) {
      // Cinematic low chase cam: behind the scorer, aimed at the ball/goal.
      const { px, pz, facing, ball } = this.scoreTarget;
      const dirx = Math.cos(facing ?? 0);
      const dirz = Math.sin(facing ?? 0);
      const dist = 4.8;
      this._tmp.set(px - dirx * dist, 2.0, pz - dirz * dist);
      this.camera.position.lerp(this._tmp, 0.12);
      const lx = ball ? ball.x : px + dirx * 12;
      const lz = ball ? ball.z : pz + dirz * 12;
      this._look.set(lx, 0.6, lz);
      this.camera.lookAt(this._look);
    } else if (this.mode !== "orbit") {
      const pose = POSES[this.mode] ?? POSES.broadcast;
      this.camera.position.lerp(pose.pos, 0.08);
      this.camera.lookAt(pose.target);
    }
    this.controls.update();
  }
}

