// Pac-Man: third-person avatar with a front-only wedge mouth (so from behind the
// camera you see its back, never the chomp) plus original space-explorer flair.
// Moves freely on the active face, collides with walls, and crosses edge-midpoint
// portals, which triggers the world rotation.
import * as THREE from 'three';
import { GRID, MID, CELL, PLAYER_RADIUS, PLAYER_SPEED, COLORS } from './config.js';
import { FACES, faceGridToLocal, crossEdge } from './cube.js';

const RC = PLAYER_RADIUS / CELL;
const COLLISION_RC = RC * 0.84; // slightly forgiving collision radius for smoother corners
const CORNER_ASSIST = 0.14;     // tiny auto-centering nudge when scraping corners

export class Player {
  constructor(group, startFace, isWallFn) {
    this.group = group;
    this.isWall = isWallFn;
    this.face = startFace;
    this.u = MID; this.v = MID;
    this.heading = 0;
    this.mouth = 0;
    this._curFrame = -1;
    this.alive = true;
    this._desiredHeading = 0;
    this.teleportCooldown = 0;
    this.teleportLockKey = null;

    this._buildMesh();
    this.syncTransform();
  }

  _buildMesh() {
    this.mesh = new THREE.Group();
    const r = PLAYER_RADIUS;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: COLORS.pacman, roughness: 0.3, metalness: 0.15,
      emissive: new THREE.Color(0x2a1e00), emissiveIntensity: 0.25, side: THREE.DoubleSide
    });

    // Prebuilt mouth frames: a wedge cut opening toward -Z (object forward = away
    // from the camera). Swapping frames animates the chomp without allocations.
    this._mouthGeos = [];
    const frames = 8;
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      const mouth = 0.05 + t * 0.85;            // radians of the wedge opening
      const g = new THREE.SphereGeometry(r, 32, 20, mouth / 2, Math.PI * 2 - mouth);
      g.rotateY(-Math.PI / 2);                  // move opening to face -Z
      g.rotateZ(Math.PI / 2);                   // convert left-right wedge to upper-lower jaws
      this._mouthGeos.push(g);
    }
    this.pac = new THREE.Mesh(this._mouthGeos[1], bodyMat);
    this.pac.castShadow = true;
    this.mesh.add(this.pac);

    // Eyes near the top-front.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.4 });
    const eyeGeo = new THREE.SphereGeometry(r * 0.12, 12, 12);
    for (const sx of [-0.34, 0.34]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(sx * r, r * 0.5, -r * 0.55);
      this.mesh.add(e);
    }

    // --- Original space-explorer decorations (visible from behind) ---
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a4260, roughness: 0.4, metalness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x53e0ff, emissive: new THREE.Color(0x53e0ff), emissiveIntensity: 0.9, roughness: 0.3
    });

    // Rear thruster (back = +Z) with an emissive flame that pulses when moving.
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.34, r * 0.5, r * 0.5, 16), metalMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, -r * 0.05, r * 0.92);
    this.mesh.add(nozzle);
    this.thrusterGlow = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.3, r * 0.8, 16),
      new THREE.MeshStandardMaterial({ color: 0xffb14d, emissive: new THREE.Color(0xff7b1a), emissiveIntensity: 1.6, transparent: true, opacity: 0.9 })
    );
    this.thrusterGlow.rotation.x = -Math.PI / 2;
    this.thrusterGlow.position.set(0, -r * 0.05, r * 1.35);
    this.mesh.add(this.thrusterGlow);

    // Antenna with glowing tip.
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, r * 0.7, 8), metalMat);
    stalk.position.set(0, r * 1.15, -r * 0.05);
    this.mesh.add(stalk);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 12, 12), accentMat);
    tip.position.set(0, r * 1.5, -r * 0.05);
    this.mesh.add(tip);

    // Two swept side fins.
    const finGeo = new THREE.BoxGeometry(r * 0.12, r * 0.5, r * 0.75);
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo, metalMat);
      fin.position.set(sx * r * 0.85, -r * 0.15, r * 0.35);
      fin.rotation.z = sx * 0.35;
      fin.castShadow = true;
      this.mesh.add(fin);
    }

    this.group.add(this.mesh);
    this._localPos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  localForward(out = new THREE.Vector3()) {
    const f = FACES[this.face];
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    out.set(0, 0, 0).addScaledVector(f.r, s).addScaledVector(f.u, c);
    return out.normalize();
  }

  worldForward(out = new THREE.Vector3()) {
    this.localForward(out);
    return out.applyQuaternion(this.group.quaternion).normalize();
  }

  getWorldPosition(out = new THREE.Vector3()) { return this.mesh.getWorldPosition(out); }

  get cellX() { return Math.round(this.u); }
  get cellY() { return Math.round(this.v); }

  _cellWall(x, y) {
    if (x === GRID && y === MID) return false;
    if (x === -1 && y === MID) return false;
    if (y === GRID && x === MID) return false;
    if (y === -1 && x === MID) return false;
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return true;
    return this.isWall(this.face, x, y);
  }

  _overlapsWall(u, v, rc = COLLISION_RC) {
    const minX = Math.floor(u - rc - 1);
    const maxX = Math.floor(u + rc + 1);
    const minY = Math.floor(v - rc - 1);
    const maxY = Math.floor(v + rc + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this._cellWall(x, y)) continue;
        const left = x - 0.5, right = x + 0.5;
        const bottom = y - 0.5, top = y + 0.5;
        const nx = Math.max(left, Math.min(u, right));
        const ny = Math.max(bottom, Math.min(v, top));
        const dx = u - nx;
        const dy = v - ny;
        if (dx * dx + dy * dy < rc * rc - 1e-6) return true;
      }
    }
    return false;
  }

  _resolveX(nu, v) {
    if (!this._overlapsWall(nu, v)) return nu;
    let lo = this.u, hi = nu;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) * 0.5;
      if (this._overlapsWall(mid, v)) hi = mid;
      else lo = mid;
    }
    return lo;
  }
  _resolveY(nv, u) {
    if (!this._overlapsWall(u, nv)) return nv;
    let lo = this.v, hi = nv;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) * 0.5;
      if (this._overlapsWall(u, mid)) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  _applyCornerAssist(blockedX, blockedY, du, dv) {
    // If we are mainly trying to move vertically but clipping a corner on X, gently
    // nudge toward the nearest lane centre so the player can "squeeze" through.
    if (blockedX && Math.abs(dv) > Math.abs(du) * 0.6) {
      const targetU = Math.round(this.u);
      const candidate = this.u + Math.max(-CORNER_ASSIST, Math.min(CORNER_ASSIST, targetU - this.u));
      if (!this._overlapsWall(candidate, this.v)) this.u = candidate;
    }
    // Symmetric case for horizontal motion grazing a corner on Y.
    if (blockedY && Math.abs(du) > Math.abs(dv) * 0.6) {
      const targetV = Math.round(this.v);
      const candidate = this.v + Math.max(-CORNER_ASSIST, Math.min(CORNER_ASSIST, targetV - this.v));
      if (!this._overlapsWall(this.u, candidate)) this.v = candidate;
    }
  }

  syncTransform() {
    const f = FACES[this.face];
    faceGridToLocal(this.face, this.u, this.v, this._localPos);
    this._localPos.addScaledVector(f.n, PLAYER_RADIUS);
    this.mesh.position.copy(this._localPos);

    const F = this.localForward(this._fwd);
    const U = f.n;
    const zAxis = F.clone().multiplyScalar(-1);
    const xAxis = new THREE.Vector3().crossVectors(U, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    this.mesh.quaternion.setFromRotationMatrix(m);
  }

  update(dt, move, world, cameraForwardWorld, cameraRightWorld) {
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);
    let isMoving = false;
    if (!world.rotating) {
      const { f, s } = move;
      if ((f !== 0 || s !== 0) && cameraForwardWorld && cameraRightWorld) {
        const desiredWorld = cameraForwardWorld.clone().multiplyScalar(f).addScaledVector(cameraRightWorld, s);
        const desiredLocal = desiredWorld.applyQuaternion(this.group.quaternion.clone().invert());
        let du = desiredLocal.dot(FACES[this.face].r);
        let dv = desiredLocal.dot(FACES[this.face].u);
        const len = Math.hypot(du, dv) || 1;
        const step = (PLAYER_SPEED * world.getSpeedMultiplier(this.face, this.u, this.v) / CELL) * dt;
        du = du / len * step; dv = dv / len * step;
        this._desiredHeading = Math.atan2(du, dv);
        const diff = Math.atan2(Math.sin(this._desiredHeading - this.heading), Math.cos(this._desiredHeading - this.heading));
        this.heading += diff * Math.min(1, dt * 14);
        const prevU = this.u;
        const prevV = this.v;
        this.u = this._resolveX(this.u + du, this.v);
        const blockedX = Math.abs(this.u - (prevU + du)) > 1e-4;
        this.v = this._resolveY(this.v + dv, this.u);
        const blockedY = Math.abs(this.v - (prevV + dv)) > 1e-4;
        if (blockedX || blockedY) this._applyCornerAssist(blockedX, blockedY, du, dv);
        this.mouth = (this.mouth + dt * 8) % (Math.PI * 2);
        isMoving = true;
        world.tryTeleportPlayer(this);
      }
      this._checkCrossing(world);
    }

    // chomp via geometry-frame swap (front-only mouth)
    let frame;
    if (isMoving) frame = Math.round(Math.abs(Math.sin(this.mouth)) * (this._mouthGeos.length - 1));
    else frame = 1;
    if (frame !== this._curFrame) { this.pac.geometry = this._mouthGeos[frame]; this._curFrame = frame; }

    // thruster reacts to motion
    const th = isMoving ? (0.85 + 0.35 * Math.abs(Math.sin(this.mouth * 2))) : 0.4;
    this.thrusterGlow.scale.set(1, th, 1);
    this.thrusterGlow.material.emissiveIntensity = isMoving ? 2.0 : 0.7;

    this.syncTransform();
  }

  _checkCrossing(world) {
    let edge = null;
    if (this.u > GRID - 1 + 0.5 && Math.abs(this.v - MID) < 0.7) edge = 'R';
    else if (this.u < -0.5 && Math.abs(this.v - MID) < 0.7) edge = 'L';
    else if (this.v > GRID - 1 + 0.5 && Math.abs(this.u - MID) < 0.7) edge = 'T';
    else if (this.v < -0.5 && Math.abs(this.u - MID) < 0.7) edge = 'B';
    if (!edge) return;

    const a = crossEdge(this.face, edge);
    this.face = a.face;
    this.u = a.cell[0] + a.heading[0] * 0.5;
    this.v = a.cell[1] + a.heading[1] * 0.5;
    this.heading = Math.atan2(a.heading[0], a.heading[1]);
    this.teleportCooldown = 0.5;
    world.startRotation(this.face);
    if (this.onCross) this.onCross();
  }

  respawn(face, u, v) {
    this.face = face; this.u = u; this.v = v; this.heading = 0; this.alive = true;
    this.teleportCooldown = 0;
    this.teleportLockKey = null;
    this.syncTransform();
  }
}
