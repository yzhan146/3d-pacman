// Ghosts: grid-based movement that routes across cube faces toward the player,
// with classic per-personality targeting, frightened flee mode, and eaten (eyes
// return home) mode.
import * as THREE from 'three';
import {
  GRID, MID, CELL, COLORS, GHOST_SPEED, GHOST_FRIGHT_SPEED, FRIGHT_COLOR, FRIGHT_FLASH
} from './config.js';
import { FACES, faceGridToLocal, crossEdge, edgeInfo, FACE_NEXT_HOP } from './cube.js';

const DIRS = { R: [1, 0], L: [-1, 0], T: [0, 1], B: [0, -1] };

function cellPortalEdge(x, y) {
  if (x === 0 && y === MID) return 'L';
  if (x === GRID - 1 && y === MID) return 'R';
  if (x === MID && y === 0) return 'B';
  if (x === MID && y === GRID - 1) return 'T';
  return null;
}

export class Ghost {
  constructor(group, index, home, isPathFn) {
    this.group = group;
    this.index = index;
    this.isPath = isPathFn;
    this.color = COLORS.ghosts[index];
    this.home = { ...home };
    this.face = home.face;
    this.cx = home.x; this.cy = home.y;
    this.dir = [0, -1];
    this.next = [this.cx, this.cy - 1];
    this.t = 0;
    this.mode = 'chase';           // chase | frightened | eaten
    this.frightTimeLeft = 0;
    this._buildMesh();
    this._pickInitialDir();
    this.syncTransform(0);
  }

  _buildMesh() {
    this.mesh = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: this.color, roughness: 0.35, metalness: 0.1,
      emissive: new THREE.Color(this.color), emissiveIntensity: 0.35
    });
    const r = 1.3;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.bodyMat);
    dome.position.y = 0.35;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.5, 28, 1, true), this.bodyMat);
    skirt.position.y = -0.4;
    this.body = new THREE.Group();
    this.body.add(dome, skirt);
    // wavy bottom
    const bumps = 6;
    for (let i = 0; i < bumps; i++) {
      const a = (i / bumps) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(r / bumps * 1.15, 12, 10), this.bodyMat);
      b.position.set(Math.cos(a) * r * 0.82, -1.15, Math.sin(a) * r * 0.82);
      this.body.add(b);
    }
    this.body.castShadow = true;
    this.mesh.add(this.body);

    // Eyes (kept visible even in eaten mode)
    this.eyes = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1030ff, roughness: 0.3, emissive: 0x0010aa, emissiveIntensity: 0.4 });
    for (const sx of [-0.5, 0.5]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), whiteMat);
      white.scale.set(1, 1.25, 1);
      white.position.set(sx, 0.5, -0.75);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), pupilMat);
      pupil.position.set(sx, 0.5, -1.05);
      this.eyes.add(white, pupil);
    }
    this.mesh.add(this.eyes);
    this.group.add(this.mesh);

    this._localPos = new THREE.Vector3();
  }

  _pickInitialDir() {
    for (const key of ['T', 'B', 'L', 'R']) {
      const d = DIRS[key];
      if (this.isPath(this.face, this.cx + d[0], this.cy + d[1])) {
        this.dir = d.slice(); this.next = [this.cx + d[0], this.cy + d[1]];
        return;
      }
    }
  }

  get speed() {
    const mul = Ghost.speedMul || 1;
    if (this.mode === 'eaten') return GHOST_SPEED * 1.9 * mul;
    if (this.mode === 'frightened') return GHOST_FRIGHT_SPEED;
    return GHOST_SPEED * mul;
  }

  enterFrightened(time) { if (this.mode !== 'eaten') { this.mode = 'frightened'; this.frightTimeLeft = time; } }
  endFrightened() { if (this.mode === 'frightened') this.mode = 'chase'; }
  getEaten() { this.mode = 'eaten'; }
  isEdible() { return this.mode === 'frightened'; }
  isDangerous() { return this.mode === 'chase'; }

  _target(player) {
    // Different face -> head to the routing portal midpoint.
    if (this.face !== player.face) {
      const edge = FACE_NEXT_HOP[this.face][player.face];
      return { cross: edge, cell: edgeInfo(this.face, edge).mid };
    }
    const px = player.cellX, py = player.cellY;
    let tx = px, ty = py;
    const fh = Math.sin(player.heading), fv = Math.cos(player.heading);
    if (this.index === 1) { tx = px + Math.round(fh * 4); ty = py + Math.round(fv * 4); }        // Pinky ahead
    else if (this.index === 2) { tx = px + Math.round(fh * 2); ty = py - Math.round(fv * 2); }    // Inky variant
    else if (this.index === 3) {
      const d = Math.hypot(px - this.cx, py - this.cy);
      if (d < 6) { tx = this.index % 2 ? 1 : GRID - 2; ty = 1; }                                  // Clyde scatter when close
    }
    return { cross: null, cell: [clamp(tx), clamp(ty)] };
  }

  _decide(player) {
    // Eaten: go home (route across faces).
    if (this.mode === 'eaten') {
      if (this.face === this.home.face && this.cx === this.home.x && this.cy === this.home.y) {
        this.mode = 'chase';
      } else if (this.face !== this.home.face) {
        const edge = FACE_NEXT_HOP[this.face][this.home.face];
        if (cellPortalEdge(this.cx, this.cy) === edge) return this._cross(edge);
        return this._greedy(edgeInfo(this.face, edge).mid);
      } else {
        return this._greedy([this.home.x, this.home.y]);
      }
    }

    if (this.mode === 'frightened') return this._random();

    const tgt = this._target(player);
    if (tgt.cross && cellPortalEdge(this.cx, this.cy) === tgt.cross) return this._cross(tgt.cross);
    return this._greedy(tgt.cell);
  }

  _neighbors() {
    const out = [];
    for (const key of ['T', 'B', 'L', 'R']) {
      const d = DIRS[key];
      const nx = this.cx + d[0], ny = this.cy + d[1];
      if (this.isPath(this.face, nx, ny)) out.push({ key, d, nx, ny });
    }
    return out;
  }

  _greedy(target) {
    const opts = this._neighbors();
    const notReverse = opts.filter(o => !(o.d[0] === -this.dir[0] && o.d[1] === -this.dir[1]));
    const pool = notReverse.length ? notReverse : opts;
    let best = pool[0], bd = Infinity;
    for (const o of pool) {
      const dd = (o.nx - target[0]) ** 2 + (o.ny - target[1]) ** 2;
      if (dd < bd) { bd = dd; best = o; }
    }
    if (best) { this.dir = best.d.slice(); this.next = [best.nx, best.ny]; }
  }

  _random() {
    const opts = this._neighbors();
    const notReverse = opts.filter(o => !(o.d[0] === -this.dir[0] && o.d[1] === -this.dir[1]));
    const pool = notReverse.length ? notReverse : opts;
    const o = pool[Math.floor(Math.random() * pool.length)];
    if (o) { this.dir = o.d.slice(); this.next = [o.nx, o.ny]; }
  }

  _cross(edge) {
    const a = crossEdge(this.face, edge);
    this.face = a.face;
    this.cx = a.cell[0]; this.cy = a.cell[1];
    this.dir = a.heading.slice();
    const nx = this.cx + this.dir[0], ny = this.cy + this.dir[1];
    if (this.isPath(this.face, nx, ny)) this.next = [nx, ny];
    else this.next = [this.cx, this.cy];
  }

  update(dt, player, frightFlash) {
    const cps = this.speed / CELL;
    this.t += cps * dt;
    while (this.t >= 1) {
      this.t -= 1;
      this.cx = this.next[0]; this.cy = this.next[1];
      this._decide(player);
    }
    this.syncTransform(this.t);

    // visuals per mode
    if (this.mode === 'frightened') {
      this.body.visible = true;
      const flash = frightFlash && Math.floor(performance.now() / 200) % 2 === 0;
      this.bodyMat.color.setHex(flash ? FRIGHT_FLASH : FRIGHT_COLOR);
      this.bodyMat.emissive.setHex(flash ? FRIGHT_FLASH : FRIGHT_COLOR);
      this.bodyMat.emissiveIntensity = 0.5;
    } else if (this.mode === 'eaten') {
      this.body.visible = false;
    } else {
      this.body.visible = true;
      this.bodyMat.color.setHex(this.color);
      this.bodyMat.emissive.setHex(this.color);
      this.bodyMat.emissiveIntensity = 0.35;
    }
  }

  syncTransform(t) {
    const f = FACES[this.face];
    const u = this.cx + (this.next[0] - this.cx) * t;
    const v = this.cy + (this.next[1] - this.cy) * t;
    faceGridToLocal(this.face, u, v, this._localPos);
    this._localPos.addScaledVector(f.n, 1.4);
    this.mesh.position.copy(this._localPos);

    // orient: -Z -> movement dir, +Y -> face normal
    const F = new THREE.Vector3().addScaledVector(f.r, this.dir[0]).addScaledVector(f.u, this.dir[1]);
    if (F.lengthSq() < 1e-6) F.copy(f.u);
    F.normalize();
    const U = f.n;
    const zAxis = F.clone().multiplyScalar(-1);
    const xAxis = new THREE.Vector3().crossVectors(U, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  }

  getWorldPosition(out = new THREE.Vector3()) { return this.mesh.getWorldPosition(out); }

  respawn() {
    this.face = this.home.face; this.cx = this.home.x; this.cy = this.home.y;
    this.t = 0; this.mode = 'chase'; this._pickInitialDir();
    this.syncTransform(0);
  }
}

function clamp(v) { return Math.max(0, Math.min(GRID - 1, v)); }

Ghost.speedMul = 1; // scaled per level for difficulty ramp
