// Third-person follow camera. Sits behind and above the player relative to the
// player's heading, smoothly easing so the world-rotation transitions feel fluid.
import * as THREE from 'three';

const DIST = 13;
const HEIGHT = 9;
const LOOK_AHEAD = 3;

const _playerPos = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camRight = new THREE.Vector3();

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.initialized = false;
    this.pitch = 0.0; // adjustable via mouse dy
    this.yaw = Math.PI;
    this.lookBehind = false;
  }

  snap(player) {
    player.worldForward(_camFwd);
    this.yaw = Math.atan2(_camFwd.x, -_camFwd.z);
    this._compute(player, _desired, _look);
    this.camera.position.copy(_desired);
    this.camera.lookAt(_look);
    this.initialized = true;
  }

  applyInput(mouseDX = 0, mouseDY = 0) {
    this.yaw += mouseDX * 0.0026;
    this.pitch = THREE.MathUtils.clamp(this.pitch + mouseDY * 0.0015, -0.6, 0.8);
  }

  setLookBehind(active) {
    this.lookBehind = !!active;
  }

  _effectiveYaw() {
    return this.yaw + (this.lookBehind ? Math.PI : 0);
  }

  getFlatForward(out = new THREE.Vector3()) {
    const yaw = this._effectiveYaw();
    return out.set(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  }

  getFlatRight(out = new THREE.Vector3()) {
    this.getFlatForward(_camFwd);
    return out.crossVectors(_camFwd, _up).normalize();
  }

  _compute(player, outPos, outLook) {
    player.getWorldPosition(_playerPos);
    this.getFlatForward(_camFwd);
    outPos.copy(_playerPos)
      .addScaledVector(_camFwd, -DIST)
      .addScaledVector(_up, HEIGHT + this.pitch * 6);
    outLook.copy(_playerPos).addScaledVector(_camFwd, LOOK_AHEAD).addScaledVector(_up, 1.5 + this.pitch * 2.2);
  }

  update(player, dt) {
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
