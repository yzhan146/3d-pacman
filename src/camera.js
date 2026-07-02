// Third-person follow camera. Sits behind and above the player relative to the
// player's heading, smoothly easing so the world-rotation transitions feel fluid.
import * as THREE from 'three';

const DIST = 13;
const HEIGHT = 9;
const LOOK_AHEAD = 3;

const _playerPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.initialized = false;
    this.pitch = 0.0; // adjustable via mouse dy
  }

  snap(player) {
    this._compute(player, _desired, _look);
    this.camera.position.copy(_desired);
    this.camera.lookAt(_look);
    this.initialized = true;
  }

  _compute(player, outPos, outLook) {
    player.getWorldPosition(_playerPos);
    player.worldForward(_fwd);
    outPos.copy(_playerPos)
      .addScaledVector(_fwd, -DIST)
      .addScaledVector(_up, HEIGHT + this.pitch * 6);
    outLook.copy(_playerPos).addScaledVector(_fwd, LOOK_AHEAD).addScaledVector(_up, 1.5);
  }

  update(player, dt, mouseDY = 0) {
    this.pitch = THREE.MathUtils.clamp(this.pitch + mouseDY * 0.0015, -0.6, 0.8);
    if (!this.initialized) { this.snap(player); return; }
    this._compute(player, _desired, _look);
    const k = 1 - Math.pow(0.0016, dt); // frame-rate independent smoothing
    this.camera.position.lerp(_desired, k);
    // smooth look target
    this._lookCurrent = this._lookCurrent || _look.clone();
    this._lookCurrent.lerp(_look, k);
    this.camera.lookAt(this._lookCurrent);
  }
}
