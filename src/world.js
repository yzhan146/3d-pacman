// Builds the 3D cube world: floors, instanced walls, instanced pellets, portal
// markers, and the smooth face-to-face rotation of the whole cube group.
import * as THREE from 'three';
import {
  CELL, HALF, WALL_HEIGHT, COLORS, CUBE_ROT_TIME, GRID, FACE_STYLES
} from './config.js';
import { FACE_IDS, FACES, faceGridToLocal, CANON_QUAT, EDGES, edgeInfo } from './cube.js';
import { PATH, DOT, POWER } from './maze.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);

function makeGridTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0f26'; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(90,130,255,0.14)';
  ctx.lineWidth = 2;
  const step = s / GRID;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(s, i * step); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeIconTexture(style) {
  const s = 192;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = style.iconColor;
  ctx.fillStyle = style.iconColor;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const mid = s / 2;
  switch (style.icon) {
    case 'sun':
      ctx.beginPath(); ctx.arc(mid, mid, 30, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(mid + Math.cos(a) * 45, mid + Math.sin(a) * 45);
        ctx.lineTo(mid + Math.cos(a) * 72, mid + Math.sin(a) * 72);
        ctx.stroke();
      }
      break;
    case 'leaf':
      ctx.beginPath();
      ctx.moveTo(mid - 38, mid + 10);
      ctx.quadraticCurveTo(mid, mid - 55, mid + 42, mid);
      ctx.quadraticCurveTo(mid, mid + 52, mid - 38, mid + 10);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mid - 18, mid + 18); ctx.lineTo(mid + 20, mid - 18); ctx.stroke();
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(mid + Math.cos(a) * 26, mid + Math.sin(a) * 26, 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(mid, mid, 14, 0, Math.PI * 2); ctx.fill();
      break;
    case 'moon':
      ctx.beginPath(); ctx.arc(mid - 6, mid, 34, -1.1, 1.1); ctx.stroke();
      ctx.beginPath(); ctx.arc(mid + 8, mid, 28, 1.25, -1.25, true); ctx.stroke();
      break;
    case 'star':
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const r = i % 2 === 0 ? 42 : 18;
        const x = mid + Math.cos(a) * r;
        const y = mid + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      break;
    case 'bird':
      ctx.beginPath();
      ctx.moveTo(mid - 52, mid + 6);
      ctx.quadraticCurveTo(mid - 22, mid - 30, mid, mid - 4);
      ctx.quadraticCurveTo(mid + 22, mid - 30, mid + 52, mid + 6);
      ctx.stroke();
      break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  constructor(scene, worldData) {
    this.scene = scene;
    this.data = worldData;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.remaining = worldData.totalDots;
    this.faceRemaining = {};
    this.rotating = false;
    this._rotT = 0;
    this._fromQuat = new THREE.Quaternion();
    this._toQuat = new THREE.Quaternion();
    this._powerData = [];
    this._time = 0;

    this._buildFloors();
    this._buildWalls();
    this._buildEmblems();
    this._buildPellets();
    this._buildPortals();
  }

  setActiveFaceImmediate(faceId) {
    this.activeFace = faceId;
    this.group.quaternion.copy(CANON_QUAT[faceId]);
  }

  _buildFloors() {
    const tex = makeGridTexture();
    const geo = new THREE.BoxGeometry(GRID * CELL, 0.6, GRID * CELL);
    this.floorMats = [];
    FACE_IDS.forEach((id, index) => {
      const style = FACE_STYLES[index % FACE_STYLES.length];
      const mat = new THREE.MeshStandardMaterial({
        map: tex, color: style.floorTint, roughness: 0.92, metalness: 0.0,
        envMapIntensity: 0.25,
        emissive: new THREE.Color(style.floorTint).multiplyScalar(0.28), emissiveIntensity: 0.16
      });
      this.floorMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      const f = FACES[id];
      m.position.copy(f.n).multiplyScalar(HALF - 0.3);
      m.quaternion.setFromUnitVectors(UP, f.n);
      m.receiveShadow = true;
      this.group.add(m);
    });
  }

  _countCells(pred) {
    let n = 0;
    for (const id of FACE_IDS) {
      const g = this.data.faces[id].grid;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (pred(id, x, y, g)) n++;
    }
    return n;
  }

  _buildWalls() {
    const count = this._countCells((id, x, y, g) => g[y][x] === 0);
    const geo = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
    this.wallMat = new THREE.MeshStandardMaterial({
      color: COLORS.wall, roughness: 0.72, metalness: 0.05, envMapIntensity: 0.35,
      emissive: new THREE.Color(COLORS.wallEmissive), emissiveIntensity: 0.14,
      vertexColors: true
    });
    const inst = new THREE.InstancedMesh(geo, this.wallMat, count);
    inst.castShadow = true; inst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    let i = 0;
    for (const id of FACE_IDS) {
      const style = FACE_STYLES[FACE_IDS.indexOf(id) % FACE_STYLES.length];
      const tint = new THREE.Color(style.wallTint);
      const g = this.data.faces[id].grid;
      const f = FACES[id];
      q.setFromUnitVectors(UP, f.n);
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (g[y][x] !== 0) continue;
        faceGridToLocal(id, x, y, pos);
        pos.addScaledVector(f.n, WALL_HEIGHT / 2);
        dummy.position.copy(pos);
        dummy.quaternion.copy(q);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i++, dummy.matrix);
        inst.setColorAt(i - 1, tint);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.walls = inst;
    this.group.add(inst);
  }

  _buildEmblems() {
    this.emblems = new THREE.Group();
    const geo = new THREE.PlaneGeometry(CELL * 2.2, CELL * 2.2);
    FACE_IDS.forEach((id, index) => {
      const style = FACE_STYLES[index % FACE_STYLES.length];
      const f = FACES[id];
      const tex = makeIconTexture(style);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.78,
        depthWrite: false
      });
      const sign = new THREE.Mesh(geo, mat);
      const base = faceGridToLocal(id, (GRID - 1) / 2, (GRID - 1) / 2, new THREE.Vector3());
      sign.position.copy(base).addScaledVector(f.n, 2.7);
      sign.quaternion.setFromUnitVectors(ZAX, f.n);
      this.emblems.add(sign);
    });
    this.group.add(this.emblems);
  }

  _buildPellets() {
    this.registry = {};
    const dots = [];
    const powers = [];
    for (const id of FACE_IDS) {
      const p = this.data.faces[id].pellets;
      const reg = Array.from({ length: GRID }, () => new Array(GRID).fill(null));
      let faceCount = 0;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (p[y][x] === DOT) { reg[y][x] = { kind: DOT, list: 'dot', idx: dots.length, eaten: false, face: id, x, y }; dots.push([id, x, y]); faceCount++; }
        else if (p[y][x] === POWER) { reg[y][x] = { kind: POWER, list: 'power', idx: powers.length, eaten: false, face: id, x, y }; powers.push([id, x, y]); faceCount++; }
      }
      this.registry[id] = reg;
      this.faceRemaining[id] = faceCount;
    }

    // Normal dots: matte, only faintly warm so bloom leaves them alone.
    const dotGeo = new THREE.SphereGeometry(0.3, 10, 10);
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0xffe6b0, emissive: new THREE.Color(0xffcf6e), emissiveIntensity: 0.14,
      roughness: 0.6, metalness: 0, envMapIntensity: 0.35
    });
    const dotInst = new THREE.InstancedMesh(dotGeo, dotMat, Math.max(1, dots.length));
    const dummy = new THREE.Object3D();
    const pos = new THREE.Vector3();
    dots.forEach(([id, x, y], i) => {
      const f = FACES[id];
      faceGridToLocal(id, x, y, pos).addScaledVector(f.n, 1.0);
      dummy.position.copy(pos); dummy.quaternion.identity(); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); dotInst.setMatrixAt(i, dummy.matrix);
    });
    dotInst.instanceMatrix.needsUpdate = true;
    this.dotInst = dotInst;
    this.group.add(dotInst);

    // Power pellets: big, vivid cyan, strongly emissive + pulsing -> clearly special.
    const powGeo = new THREE.SphereGeometry(0.95, 20, 20);
    const powMat = new THREE.MeshStandardMaterial({
      color: 0x9ff6ff, emissive: new THREE.Color(0x53e6ff), emissiveIntensity: 1.7,
      roughness: 0.25, metalness: 0
    });
    const powInst = new THREE.InstancedMesh(powGeo, powMat, Math.max(1, powers.length));
    powers.forEach(([id, x, y], i) => {
      const f = FACES[id];
      const p = faceGridToLocal(id, x, y, new THREE.Vector3()).addScaledVector(f.n, 1.2);
      this._powerData.push({ idx: i, pos: p.clone() });
      dummy.position.copy(p); dummy.quaternion.identity(); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); powInst.setMatrixAt(i, dummy.matrix);
    });
    powInst.instanceMatrix.needsUpdate = true;
    this.powInst = powInst;
    this.group.add(powInst);
    this._dummy = dummy;
  }

  _buildPortals() {
    // Mark each edge-midpoint portal with a calm green floor tile that turns
    // amber while the player is standing on it (a "step-on" feedback).
    this.portals = new THREE.Group();
    this.portalTiles = new Map();
    this._activePortalKey = null;
    const geo = new THREE.BoxGeometry(CELL * 0.92, 0.5, CELL * 0.92);
    const q = new THREE.Quaternion();
    for (const id of FACE_IDS) {
      const f = FACES[id];
      for (const e of EDGES) {
        const mid = edgeInfo(id, e).mid;
        const base = faceGridToLocal(id, mid[0], mid[1], new THREE.Vector3());
        const mat = new THREE.MeshStandardMaterial({
          color: 0x2ecb74, emissive: new THREE.Color(0x0f7a44), emissiveIntensity: 0.35,
          roughness: 0.6, metalness: 0.0
        });
        const tile = new THREE.Mesh(geo, mat);
        tile.position.copy(base).addScaledVector(f.n, 0.08);
        q.setFromUnitVectors(UP, f.n); tile.quaternion.copy(q);
        tile.receiveShadow = true;
        this.portals.add(tile);
        this.portalTiles.set(`${id}:${mid[0]}:${mid[1]}`, tile);
      }
    }
    this.group.add(this.portals);
  }

  // Highlight the portal tile the player is standing on (amber), reset others.
  setPlayerCell(faceId, x, y) {
    const key = `${faceId}:${x}:${y}`;
    if (key === this._activePortalKey) return;
    if (this._activePortalKey && this.portalTiles.has(this._activePortalKey)) {
      const m = this.portalTiles.get(this._activePortalKey).material;
      m.color.setHex(0x2ecb74); m.emissive.setHex(0x0f7a44); m.emissiveIntensity = 0.35;
    }
    if (this.portalTiles.has(key)) {
      const m = this.portalTiles.get(key).material;
      m.color.setHex(0xffd21a); m.emissive.setHex(0xff9e1a); m.emissiveIntensity = 0.8;
      this._activePortalKey = key;
    } else {
      this._activePortalKey = null;
    }
  }

  eatPelletAt(faceId, x, y) {
    const reg = this.registry[faceId]?.[y]?.[x];
    if (!reg || reg.eaten) return null;
    reg.eaten = true;
    this.remaining--;
    this.faceRemaining[reg.face]--;
    const inst = reg.list === 'dot' ? this.dotInst : this.powInst;
    this._dummy.scale.set(0, 0, 0);
    this._dummy.position.set(0, 0, 0);
    this._dummy.quaternion.identity();
    this._dummy.updateMatrix();
    inst.setMatrixAt(reg.idx, this._dummy.matrix);
    inst.instanceMatrix.needsUpdate = true;
    return reg.kind;
  }

  startRotation(faceId) {
    this.activeFace = faceId;
    this._fromQuat.copy(this.group.quaternion);
    this._toQuat.copy(CANON_QUAT[faceId]);
    this._rotT = 0;
    this.rotating = true;
  }

  setTheme(theme) {
    this.wallMat.emissive.setHex(theme.wallEmissive);
    for (const m of this.floorMats) m.envMapIntensity = 0.22;
  }

  update(dt) {
    this._time += dt;
    if (this.rotating) {
      this._rotT += dt / CUBE_ROT_TIME;
      if (this._rotT >= 1) { this._rotT = 1; this.rotating = false; }
      const e = easeInOutCubic(this._rotT);
      this.group.quaternion.copy(this._fromQuat).slerp(this._toQuat, e);
    }
    const pulse = 1 + 0.3 * Math.sin(this._time * 5);
    for (const pd of this._powerData) {
      const reg = this._powerRegByIdx(pd.idx);
      if (reg && reg.eaten) continue;
      this._dummy.position.copy(pd.pos);
      this._dummy.quaternion.identity();
      this._dummy.scale.setScalar(pulse);
      this._dummy.updateMatrix();
      this.powInst.setMatrixAt(pd.idx, this._dummy.matrix);
    }
    this.powInst.instanceMatrix.needsUpdate = true;
  }

  _powerRegByIdx(idx) {
    if (!this._powerIdxMap) {
      this._powerIdxMap = {};
      for (const id of FACE_IDS) {
        const reg = this.registry[id];
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
          const r = reg[y][x];
          if (r && r.list === 'power') this._powerIdxMap[r.idx] = r;
        }
      }
    }
    return this._powerIdxMap[idx];
  }

  worldPos(faceId, u, v, out = new THREE.Vector3()) {
    faceGridToLocal(faceId, u, v, out);
    return this.group.localToWorld(out);
  }
}

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
