// Builds the 3D cube world: refined floors, instanced walls, instanced pellets,
// portal markers, and the smooth face-to-face rotation of the whole cube group.
import * as THREE from 'three';
import {
  CELL, HALF, WALL_HEIGHT, COLORS, CUBE_ROT_TIME, GRID, FACE_STYLES
} from './config.js';
import { FACE_IDS, FACES, faceGridToLocal, CANON_QUAT, EDGES, edgeInfo, crossEdge } from './cube.js';
import { PATH, DOT, POWER } from './maze.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const FACE_EFFECT_PLAN = {
  PY: 'classic',
  PX: 'mud',
  PZ: 'teleport'
};
const EDGE_PORTAL_COOLDOWN = 2.0;

function makeGridTexture(baseColor) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const rgb = new THREE.Color(baseColor);
  const dark = `rgb(${Math.round(18 + rgb.r * 44)}, ${Math.round(20 + rgb.g * 46)}, ${Math.round(24 + rgb.b * 52)})`;
  const light = `rgb(${Math.round(34 + rgb.r * 60)}, ${Math.round(36 + rgb.g * 62)}, ${Math.round(40 + rgb.b * 68)})`;
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, dark);
  g.addColorStop(1, light);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  // Subtle crystal / marble veining.
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const len = 70 + Math.random() * 120;
    const angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.02})`;
    ctx.lineWidth = 1 + Math.random() * 1.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let t = 0; t < 4; t++) {
      const nx = x + Math.cos(angle + (Math.random() - 0.5) * 0.35) * len * (t + 1) / 4;
      const ny = y + Math.sin(angle + (Math.random() - 0.5) * 0.35) * len * (t + 1) / 4;
      ctx.lineTo(nx, ny);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1.5;
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

export class World {
  constructor(scene, worldData) {
    this.scene = scene;
    this.data = worldData;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.effects = {};
    this._initFaceEffects();
    this.edgePortalState = new Map();
    this.edgePortalTiles = new Map();
    this.tilePairKeys = new Map();

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
    this._buildFaceEffects();
    this._buildPellets();
    this._buildPortals();
  }

  _cellKey(x, y) { return `${x}:${y}`; }
  _edgePortalKey(faceId, edge) {
    const a = FACES[faceId].n;
    const b = edgeInfo(faceId, edge).neighborNormal;
    return [`${a.x},${a.y},${a.z}`, `${b.x},${b.y},${b.z}`].sort().join('|');
  }

  _nearestPathCell(faceId, ax, ay, used = null) {
    const grid = this.data.faces[faceId].grid;
    let best = null, bestD = Infinity;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      if (grid[y][x] !== PATH) continue;
      const key = this._cellKey(x, y);
      if (used && used.has(key)) continue;
      const d = (x - ax) ** 2 + (y - ay) ** 2;
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
    return best;
  }

  _initFaceEffects() {
    for (const id of FACE_IDS) this.effects[id] = { type: FACE_EFFECT_PLAN[id] || 'classic' };

    // Mud pits on PX
    {
      const faceId = 'PX';
      const anchors = [[2, 2], [GRID - 3, 3], [Math.floor(GRID / 2), GRID - 3]];
      const cells = new Set();
      const grid = this.data.faces[faceId].grid;
      for (const [ax, ay] of anchors) {
        const seed = this._nearestPathCell(faceId, ax, ay);
        if (!seed) continue;
        const [sx, sy] = seed;
        [[0,0],[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
          const x = sx + dx, y = sy + dy;
          if (x >= 0 && x < GRID && y >= 0 && y < GRID && grid[y][x] === PATH) cells.add(this._cellKey(x, y));
        });
      }
      this.effects[faceId].cells = cells;
    }

    // Same-face teleporter pads on PZ (2 pairs)
    {
      const faceId = 'PZ';
      const used = new Set();
      const rawPairs = [
        [[2, 2], [GRID - 3, GRID - 3]],
        [[2, GRID - 3], [GRID - 3, 2]]
      ];
      const map = new Map();
      const pads = [];
      const pairs = [];
      for (const [a, b] of rawPairs) {
        const pa = this._nearestPathCell(faceId, a[0], a[1], used);
        if (pa) used.add(this._cellKey(pa[0], pa[1]));
        const pb = this._nearestPathCell(faceId, b[0], b[1], used);
        if (pb) used.add(this._cellKey(pb[0], pb[1]));
        if (!pa || !pb) continue;
        map.set(this._cellKey(pa[0], pa[1]), pb);
        map.set(this._cellKey(pb[0], pb[1]), pa);
        pads.push(pa, pb);
        pairs.push([pa, pb]);
        // remove pellets on teleporter cells
        const pellets = this.data.faces[faceId].pellets;
        for (const [x, y] of [pa, pb]) {
          if (pellets[y][x] !== 0) {
            pellets[y][x] = 0;
            this.data.faces[faceId].dotCount--;
            this.data.totalDots--;
          }
        }
      }
      this.effects[faceId].map = map;
      this.effects[faceId].pads = pads;
      this.effects[faceId].pairs = pairs;
    }
  }

  setActiveFaceImmediate(faceId) {
    this.activeFace = faceId;
    this.group.quaternion.copy(CANON_QUAT[faceId]);
  }

  _buildFloors() {
    const geo = new THREE.BoxGeometry(GRID * CELL, 0.6, GRID * CELL);
    this.floorMats = [];
    FACE_IDS.forEach((id, index) => {
      const style = FACE_STYLES[index % FACE_STYLES.length];
      const tex = makeGridTexture(style.floorTint);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xaeb6c2,
        roughness: 0.72,
        metalness: 0.01,
        envMapIntensity: 0.06,
        emissive: new THREE.Color(style.floorTint).multiplyScalar(0.1),
        emissiveIntensity: 0.1
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
    const geo = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
    this.walls = new THREE.Group();
    this.wallMeshes = {};
    const dummy = new THREE.Object3D();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();

    for (const id of FACE_IDS) {
      const g = this.data.faces[id].grid;
      const count = this._countCells((faceId, x, y, grid) => faceId === id && grid[y][x] === 0);
      const style = FACE_STYLES[FACE_IDS.indexOf(id) % FACE_STYLES.length];
      const tint = new THREE.Color(style.wallTint);
      const mat = new THREE.MeshStandardMaterial({
        color: tint,
        roughness: 0.82,
        metalness: 0.02,
        envMapIntensity: 0.08,
        emissive: tint.clone().multiplyScalar(0.12),
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      const f = FACES[id];
      q.setFromUnitVectors(UP, f.n);
      let i = 0;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (g[y][x] !== 0) continue;
        faceGridToLocal(id, x, y, pos);
        pos.addScaledVector(f.n, WALL_HEIGHT / 2);
        dummy.position.copy(pos);
        dummy.quaternion.copy(q);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i++, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.wallMeshes[id] = inst;
      this.walls.add(inst);
    }
    this.group.add(this.walls);
  }

  _buildFaceEffects() {
    this.effectMeshes = new THREE.Group();
    this.teleportMeshes = [];

    // Mud visuals
    const mudMat = new THREE.MeshStandardMaterial({
      color: 0x4f3b2b, emissive: 0x1f1208, emissiveIntensity: 0.14,
      roughness: 0.98, metalness: 0
    });
    const mudGeo = new THREE.CylinderGeometry(CELL * 0.4, CELL * 0.52, 0.12, 18);
    for (const key of this.effects.PX?.cells || []) {
      const [x, y] = key.split(':').map(Number);
      const f = FACES.PX;
      const base = faceGridToLocal('PX', x, y, new THREE.Vector3());
      const mesh = new THREE.Mesh(mudGeo, mudMat);
      mesh.position.copy(base).addScaledVector(f.n, 0.05);
      mesh.quaternion.setFromUnitVectors(UP, f.n);
      this.effectMeshes.add(mesh);
    }

    // Teleporter visuals
    const holeGeo = new THREE.CylinderGeometry(CELL * 0.18, CELL * 0.62, 0.34, 28);
    const coreGeo = new THREE.CylinderGeometry(CELL * 0.08, CELL * 0.34, 0.22, 24);
    const rimGeo = new THREE.TorusGeometry(CELL * 0.44, 0.08, 10, 24);
    const pairColors = [0x7f6bff, 0xff8fb8];
    let pairIndex = 0;
    for (const pair of this.effects.PZ?.pairs || []) {
      const color = pairColors[pairIndex++ % pairColors.length];
      const holeMat = new THREE.MeshStandardMaterial({
        color: 0x07070b,
        emissive: color,
        emissiveIntensity: 0.22,
        roughness: 0.92,
        metalness: 0.0,
        transparent: true,
        opacity: 0.98
      });
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x030308,
        emissive: color,
        emissiveIntensity: 0.1,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.95
      });
      const rimMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 0.92
      });
      for (const pad of pair) {
        const [x, y] = pad;
        const f = FACES.PZ;
        const base = faceGridToLocal('PZ', x, y, new THREE.Vector3());

        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.position.copy(base).addScaledVector(f.n, 0.02);
        hole.quaternion.setFromUnitVectors(UP, f.n);
        hole.scale.y = 0.5;
        this.effectMeshes.add(hole);

        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.copy(base).addScaledVector(f.n, 0.015);
        core.quaternion.setFromUnitVectors(UP, f.n);
        core.scale.y = 0.45;
        this.effectMeshes.add(core);

        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.copy(base).addScaledVector(f.n, 0.16);
        rim.quaternion.setFromUnitVectors(ZAX, f.n);
        this.effectMeshes.add(rim);
        this.teleportMeshes.push({ hole, core, rim });
      }
    }

    this.group.add(this.effectMeshes);
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

  getSpeedMultiplier(faceId, u, v) {
    const fx = this.effects[faceId];
    if (!fx || fx.type !== 'mud') return 1;
    const key = this._cellKey(Math.round(u), Math.round(v));
    return fx.cells.has(key) ? 0.42 : 1;
  }

  tryTeleportPlayer(player) {
    const fx = this.effects[player.face];
    if (!fx || fx.type !== 'teleport') return false;
    const key = this._cellKey(player.cellX, player.cellY);
    if (player.teleportLockKey && key !== player.teleportLockKey) player.teleportLockKey = null;
    if (player.teleportLockKey === key) return false;
    if (player.teleportCooldown > 0) return false;
    const dest = fx.map.get(key);
    if (!dest) return false;
    player.u = dest[0];
    player.v = dest[1];
    player.teleportLockKey = this._cellKey(dest[0], dest[1]);
    player.teleportCooldown = 0.08;
    return true;
  }

  tryTeleportGhost(ghost) {
    return false;
  }

  _buildPortals() {
    // Mark each edge-midpoint portal with a calm green floor tile that turns
    // amber while the player is standing on it (a "step-on" feedback).
    this.portals = new THREE.Group();
    this.portalTiles = new Map();
    this.edgePortalVisuals = new Map();
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
        const pairKey = this._edgePortalKey(id, e);
        const tileKey = `${id}:${mid[0]}:${mid[1]}`;
        this.portalTiles.set(tileKey, tile);
        this.tilePairKeys.set(tileKey, pairKey);
        if (!this.edgePortalTiles.has(pairKey)) this.edgePortalTiles.set(pairKey, []);
        this.edgePortalTiles.get(pairKey).push(tile);
        if (!this.edgePortalVisuals.has(pairKey)) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 128;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          const mat2 = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 });
          this.edgePortalVisuals.set(pairKey, { canvas, tex, progress: 0, meshes: [] });
        }
        const vis = this.edgePortalVisuals.get(pairKey);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.8, CELL * 0.8), vis.mat || (vis.mat = new THREE.MeshBasicMaterial({ map: vis.tex, transparent: true, depthWrite: false, opacity: 0.95 })));
        plane.position.copy(base).addScaledVector(f.n, 0.34);
        plane.quaternion.setFromUnitVectors(ZAX, f.n);
        plane.visible = false;
        vis.meshes.push(plane);
        this.portals.add(plane);
      }
    }
    this.group.add(this.portals);
  }

  _drawCooldownCanvas(canvas, progress) {
    const ctx = canvas.getContext('2d');
    const s = canvas.width;
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffd21a';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }

  tryUseFacePortal(kind, faceId, edge) {
    const pairKey = this._edgePortalKey(faceId, edge);
    const state = this.edgePortalState.get(pairKey);
    if (state && state.cooldown > 0) return null;
    this.edgePortalState.set(pairKey, { cooldown: EDGE_PORTAL_COOLDOWN, by: kind });
    for (const tile of this.edgePortalTiles.get(pairKey) || []) {
      tile.material.color.setHex(0x1b2b20);
      tile.material.emissive.setHex(0x000000);
      tile.material.emissiveIntensity = 0.02;
    }
    return crossEdge(faceId, edge);
  }

  // Highlight the portal tile the player is standing on (amber), reset others.
  setPlayerCell(faceId, x, y) {
    const key = `${faceId}:${x}:${y}`;
    if (key === this._activePortalKey) return;
    if (this._activePortalKey && this.portalTiles.has(this._activePortalKey)) {
      const m = this.portalTiles.get(this._activePortalKey).material;
      const prevPairKey = this.tilePairKeys.get(this._activePortalKey);
      const prevState = prevPairKey ? this.edgePortalState.get(prevPairKey) : null;
      if (!prevState || prevState.cooldown <= 0) {
        m.color.setHex(0x2ecb74); m.emissive.setHex(0x0f7a44); m.emissiveIntensity = 0.35;
      }
    }
    if (this.portalTiles.has(key)) {
      const pairKey = this.tilePairKeys.get(key);
      const state = pairKey ? this.edgePortalState.get(pairKey) : null;
      const m = this.portalTiles.get(key).material;
      if (!state || state.cooldown <= 0) {
        m.color.setHex(0xffd21a); m.emissive.setHex(0xff9e1a); m.emissiveIntensity = 0.8;
      }
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
    this._refreshFaceClearState(reg.face);
    const inst = reg.list === 'dot' ? this.dotInst : this.powInst;
    this._dummy.scale.set(0, 0, 0);
    this._dummy.position.set(0, 0, 0);
    this._dummy.quaternion.identity();
    this._dummy.updateMatrix();
    inst.setMatrixAt(reg.idx, this._dummy.matrix);
    inst.instanceMatrix.needsUpdate = true;
    return reg.kind;
  }

  _refreshFaceClearState(faceId) {
    const reg = this.registry?.[faceId];
    if (!reg) return;
    let remaining = 0;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const cell = reg[y][x];
        if (cell && !cell.eaten) remaining++;
      }
    }
    this.faceRemaining[faceId] = remaining;
    if (remaining === 0) this._markFaceCleared(faceId);
    else this._markFaceUncleared(faceId);
  }

  _markFaceCleared(faceId) {
    const inst = this.wallMeshes?.[faceId];
    if (!inst) return;
    const mat = inst.material;
    const base = mat.color.clone();
    mat.emissive = base.clone().multiplyScalar(0.28);
    mat.emissiveIntensity = 0.18;
    mat.opacity = 1;
    mat.transparent = false;
    mat.depthWrite = true;
    mat.needsUpdate = true;
  }

  _markFaceUncleared(faceId) {
    const inst = this.wallMeshes?.[faceId];
    if (!inst) return;
    const mat = inst.material;
    mat.opacity = 0.42;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.needsUpdate = true;
  }

  startRotation(faceId) {
    this.activeFace = faceId;
    this._fromQuat.copy(this.group.quaternion);
    this._toQuat.copy(CANON_QUAT[faceId]);
    this._rotT = 0;
    this.rotating = true;
  }

  setTheme(theme) {
    for (const m of this.floorMats) m.envMapIntensity = 0.06;
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

    for (const t of this.teleportMeshes || []) {
      t.rim.rotation.z += dt * 2.2;
      const pulse = 0.9 + 0.12 * Math.sin(this._time * 4.5);
      t.core.scale.set(1, 0.45 * pulse, 1);
      t.hole.scale.set(1, 0.5 + 0.08 * Math.sin(this._time * 3.8), 1);
    }

    for (const [key, vis] of this.edgePortalVisuals.entries()) {
      const state = this.edgePortalState.get(key);
      if (state && state.cooldown > 0) {
        state.cooldown = Math.max(0, state.cooldown - dt);
        const p = 1 - (state.cooldown / EDGE_PORTAL_COOLDOWN);
        this._drawCooldownCanvas(vis.canvas, p);
        vis.tex.needsUpdate = true;
        vis.meshes.forEach(m => { m.visible = true; });
        const color = new THREE.Color(0x1b2b20).lerp(new THREE.Color(0x2ecb74), p);
        const glow = 0.02 + 0.33 * p;
        for (const tile of this.edgePortalTiles.get(key) || []) {
          tile.material.color.copy(color);
          tile.material.emissive.setHex(0x0f7a44);
          tile.material.emissiveIntensity = glow;
        }
        if (state.cooldown <= 0) {
          vis.meshes.forEach(m => { m.visible = false; });
          for (const tile of this.edgePortalTiles.get(key) || []) {
            tile.material.color.setHex(0x2ecb74);
            tile.material.emissive.setHex(0x0f7a44);
            tile.material.emissiveIntensity = 0.35;
          }
        }
      }
    }
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
