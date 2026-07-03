// Builds the 3D cube world: refined floors, instanced walls, instanced pellets,
// portal markers, and the smooth face-to-face rotation of the whole cube group.
import * as THREE from 'three';
import {
  CELL, HALF, WALL_HEIGHT, COLORS, CUBE_ROT_TIME, GRID, MID, FACE_STYLES
} from './config.js';
import { PATH, DOT, POWER } from './maze.js';

const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const FACE_EFFECT_PLAN = {
  PY: 'classic',
  PX: 'mud',
  PZ: 'teleport',
  NX: 'speed',
  NY: 'gate',
  NZ: 'sanctuary'
};
const TETRA_EFFECT_PLAN = {
  TA: 'safe',
  TB: 'pendulum',
  TC: 'ironball',
  TD: 'hammer'
};
const EDGE_PORTAL_COOLDOWN = 2.0;
const GATE_OPEN_TIME = 2.0;
const GATE_CLOSED_TIME = 1.8;
const PENDULUM_PERIOD = 3.2;
const IRONBALL_PERIOD = 4.8;
const HAMMER_PERIOD = 3.4;

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

function makePrismWallTexture(baseColor) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, `rgb(${Math.round(65 + base.r * 110)}, ${Math.round(72 + base.g * 100)}, ${Math.round(80 + base.b * 110)})`);
  g.addColorStop(1, `rgb(${Math.round(18 + base.r * 42)}, ${Math.round(22 + base.g * 38)}, ${Math.round(32 + base.b * 46)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = -s; i < s * 2; i += 34) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(i, 0, 10, s);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(i + 16, 0, 6, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1.2);
  return tex;
}

export class World {
  constructor(scene, worldData, spec) {
    this.scene = scene;
    this.data = worldData;
    this.spec = spec;
    this.topology = spec.topology;
    this.faceIds = this.topology.faceIds;
    this.faces = this.topology.faces;
    this.edges = this.topology.edges;
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
    const a = this.faces[faceId].n;
    const dest = this.topology.crossEdge(faceId, edge);
    const b = this.faces[dest.face].n;
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
    const plan = this.topology.kind === 'tetra' ? TETRA_EFFECT_PLAN : FACE_EFFECT_PLAN;
    for (const id of this.faceIds) this.effects[id] = { type: plan[id] || 'classic' };
    if (this.topology.kind === 'tetra') {
      this._initLevel2Effects();
      return;
    }

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

    // Speed strips on NX
    {
      const faceId = 'NX';
      const grid = this.data.faces[faceId].grid;
      const strips = [];
      for (const y0 of [2, GRID - 3]) {
        const cells = new Set();
        for (let x = 1; x < GRID - 1; x++) {
          if (Math.abs(x - MID) <= 1) continue; // keep cross-plane portal approaches clean
          for (let y = Math.max(0, y0 - 1); y <= Math.min(GRID - 1, y0 + 1); y++) {
            if (grid[y][x] === PATH) cells.add(this._cellKey(x, y));
          }
        }
        strips.push({ cells, dir: [1, 0] });
      }
      this.effects[faceId].strips = strips;
    }

    // Gate strip on NY
    {
      const faceId = 'NY';
      const grid = this.data.faces[faceId].grid;
      const cells = new Set();
      const x0 = Math.floor(GRID / 2);
      for (let y = 2; y < GRID - 2; y++) {
        if (grid[y][x0] === PATH) cells.add(this._cellKey(x0, y));
      }
      this.effects[faceId].cells = cells;
      this.effects[faceId].phase = 0.7;
    }

    // Sanctuary pads on NZ
    {
      const faceId = 'NZ';
      const sanctuaries = [];
      for (const anchor of [[2, 2], [GRID - 3, GRID - 3], [2, GRID - 3]]) {
        const seed = this._nearestPathCell(faceId, anchor[0], anchor[1]);
        if (!seed) continue;
        sanctuaries.push({ cell: seed });
      }
      this.effects[faceId].sanctuaries = sanctuaries;
    }
  }

  _initLevel2Effects() {
    const pendulumFace = 'TB';
    this.effects[pendulumFace].pendulums = [
      { anchor: [MID - 2, MID - 1], phase: 0 },
      { anchor: [MID + 2, MID - 1], phase: 1.3 }
    ];

    const ironFace = 'TC';
    this.effects[ironFace].ballTrack = [
      [2, MID], [MID - 1, MID], [MID + 2, MID], [GRID - 3, MID],
      [MID + 1, MID - 2], [MID - 1, MID - 2]
    ];

    const hammerFace = 'TD';
    this.effects[hammerFace].hammers = [
      { cell: [MID - 2, MID - 1], phase: 0.3 },
      { cell: [MID + 2, MID - 1], phase: 1.5 },
      { cell: [MID, MID - 3], phase: 2.2 }
    ];
  }

  setActiveFaceImmediate(faceId) {
    this.activeFace = faceId;
    this.group.quaternion.copy(this.topology.canonQuat[faceId]);
  }

  _buildFloors() {
    this.floorMats = [];
    this.faceIds.forEach((id, index) => {
      const style = FACE_STYLES[index % FACE_STYLES.length];
      const tex = makeGridTexture(style.floorTint);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xaeb6c2,
        roughness: 0.72,
        metalness: 0.01,
        envMapIntensity: 0.06,
        emissive: new THREE.Color(style.floorTint).multiplyScalar(0.1),
        emissiveIntensity: 0.1,
        side: this.topology.kind === 'tetra' ? THREE.DoubleSide : THREE.FrontSide
      });
      this.floorMats.push(mat);
      const geo = this.topology.kind === 'tetra'
        ? new THREE.CircleGeometry(GRID * CELL * 0.56, 3)
        : new THREE.BoxGeometry(GRID * CELL, 0.6, GRID * CELL);
      const m = new THREE.Mesh(geo, mat);
      const f = this.faces[id];
      m.position.copy(f.n).multiplyScalar(HALF - 0.3);
      m.quaternion.setFromUnitVectors(this.topology.kind === 'tetra' ? ZAX : UP, f.n);
      if (this.topology.kind === 'tetra') m.rotateOnAxis(f.n, Math.PI / 2);
      m.receiveShadow = true;
      this.group.add(m);
    });
  }

  _countCells(pred) {
    let n = 0;
    for (const id of this.faceIds) {
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

    for (const id of this.faceIds) {
      const g = this.data.faces[id].grid;
      const count = this._countCells((faceId, x, y, grid) => faceId === id && grid[y][x] === 0);
      const style = FACE_STYLES[this.faceIds.indexOf(id) % FACE_STYLES.length];
      const tint = new THREE.Color(style.wallTint);
      const wallMap = this.topology.kind === 'tetra' ? makePrismWallTexture(style.wallTint) : null;
      const mat = new THREE.MeshStandardMaterial({
        map: wallMap,
        color: tint,
        roughness: 0.82,
        metalness: 0.02,
        envMapIntensity: 0.08,
        emissive: tint.clone().multiplyScalar(0.12),
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: this.topology.kind === 'tetra' ? 0.56 : 0.42,
        depthWrite: false
      });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      const f = this.faces[id];
      q.setFromUnitVectors(UP, f.n);
      let i = 0;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (g[y][x] !== 0) continue;
        this.topology.faceGridToLocal(id, x, y, pos);
        pos.addScaledVector(f.n, WALL_HEIGHT / 2);
        dummy.position.copy(pos);
        dummy.quaternion.copy(q);
        if (this.topology.kind === 'tetra') dummy.scale.set(0.86, 1, 0.86);
        else dummy.scale.set(1, 1, 1);
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
    if (this.topology.kind === 'tetra') {
      this._buildLevel2Effects();
      this.group.add(this.effectMeshes);
      return;
    }

    // Mud visuals
    const mudMat = new THREE.MeshStandardMaterial({
      color: 0x4f3b2b, emissive: 0x1f1208, emissiveIntensity: 0.14,
      roughness: 0.98, metalness: 0
    });
    const mudGeo = new THREE.CylinderGeometry(CELL * 0.4, CELL * 0.52, 0.12, 18);
    for (const key of this.effects.PX?.cells || []) {
      const [x, y] = key.split(':').map(Number);
      const f = this.faces.PX;
      const base = this.topology.faceGridToLocal('PX', x, y, new THREE.Vector3());
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
        const f = this.faces.PZ;
        const base = this.topology.faceGridToLocal('PZ', x, y, new THREE.Vector3());

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

    // Speed strip visuals (NX): cool hex energy cells
    const speedGeo = new THREE.CylinderGeometry(CELL * 0.28, CELL * 0.28, 0.06, 6);
    for (const strip of this.effects.NX?.strips || []) {
      for (const key of strip.cells) {
        const [x, y] = key.split(':').map(Number);
        const f = this.faces.NX;
        const base = this.topology.faceGridToLocal('NX', x, y, new THREE.Vector3());
        const mesh = new THREE.Mesh(speedGeo, new THREE.MeshStandardMaterial({
          color: 0x7ce6ff, emissive: 0x44cfff, emissiveIntensity: 0.18,
          roughness: 0.28, metalness: 0.02, transparent: true, opacity: 0.82
        }));
        mesh.position.copy(base).addScaledVector(f.n, 0.06);
        mesh.quaternion.setFromUnitVectors(UP, f.n);
        this.effectMeshes.add(mesh);
      }
    }

    // Gate visuals (NY)
    this.gateMeshes = [];
    const gateGeo = new THREE.BoxGeometry(CELL * 0.9, WALL_HEIGHT * 0.95, CELL * 0.12);
    for (const key of this.effects.NY?.cells || []) {
      const [x, y] = key.split(':').map(Number);
      const f = this.faces.NY;
      const base = this.topology.faceGridToLocal('NY', x, y, new THREE.Vector3());
      const mesh = new THREE.Mesh(gateGeo, new THREE.MeshStandardMaterial({
        color: 0xffc870, emissive: 0xffb34d, emissiveIntensity: 0.2,
        roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.9
      }));
      mesh.position.copy(base).addScaledVector(f.n, 0.02);
      mesh.quaternion.setFromUnitVectors(UP, f.n);
      mesh.scale.y = 0.02;
      this.effectMeshes.add(mesh);
      this.gateMeshes.push(mesh);
    }

    // Sanctuary visuals (NZ) - translucent protective domes
    this.sanctuaryMeshes = [];
    const domeGeo = new THREE.SphereGeometry(CELL * 0.44, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const ringGeo2 = new THREE.TorusGeometry(CELL * 0.42, 0.05, 10, 28);
    for (const s of this.effects.NZ?.sanctuaries || []) {
      const [x, y] = s.cell;
      const f = this.faces.NZ;
      const base = this.topology.faceGridToLocal('NZ', x, y, new THREE.Vector3());

      const shell = new THREE.Mesh(domeGeo, new THREE.MeshStandardMaterial({
        color: 0xaaf4ff,
        emissive: 0x76ddff,
        emissiveIntensity: 0.18,
        roughness: 0.18,
        metalness: 0,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide
      }));
      shell.position.copy(base).addScaledVector(f.n, 0.9);
      shell.quaternion.setFromUnitVectors(UP, f.n);
      this.effectMeshes.add(shell);

      const ring = new THREE.Mesh(ringGeo2, new THREE.MeshStandardMaterial({
        color: 0xbff7ff,
        emissive: 0x7ae2ff,
        emissiveIntensity: 0.35,
        roughness: 0.22,
        metalness: 0.05,
        transparent: true,
        opacity: 0.75
      }));
      ring.position.copy(base).addScaledVector(f.n, 0.08);
      ring.quaternion.setFromUnitVectors(ZAX, f.n);
      this.effectMeshes.add(ring);

      const core = new THREE.Mesh(new THREE.CylinderGeometry(CELL * 0.16, CELL * 0.2, 0.08, 24), new THREE.MeshStandardMaterial({
        color: 0xe2fbff,
        emissive: 0x9cecff,
        emissiveIntensity: 0.18,
        roughness: 0.25,
        metalness: 0,
        transparent: true,
        opacity: 0.55
      }));
      core.position.copy(base).addScaledVector(f.n, 0.05);
      core.quaternion.setFromUnitVectors(UP, f.n);
      this.effectMeshes.add(core);

      this.sanctuaryMeshes.push({ shell, ring, core });
    }

    this.group.add(this.effectMeshes);
  }

  _buildLevel2Effects() {
    this.hazardMeshes = { pendulums: [], balls: [], hammers: [] };

    const pendulumFace = this.faces.TB;
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x3a3d46, roughness: 0.42, metalness: 0.75 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1e25, emissive: 0x080b10, emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.86 });
    for (const p of this.effects.TB?.pendulums || []) {
      const anchorBase = this.topology.faceGridToLocal('TB', p.anchor[0], p.anchor[1], new THREE.Vector3()).addScaledVector(pendulumFace.n, 6.2);
      const pivot = new THREE.Group();
      pivot.position.copy(anchorBase);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8), chainMat);
      shaft.position.y = -2.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), headMat);
      head.scale.set(1.08, 1.08, 1.08);
      head.position.y = -4.8;
      pivot.add(shaft, head);
      pivot.quaternion.setFromUnitVectors(UP, pendulumFace.n);
      this.effectMeshes.add(pivot);
      this.hazardMeshes.pendulums.push({ mesh: pivot, head, face: 'TB', phase: p.phase });
    }

    const trackFace = this.faces.TC;
    const railMat = new THREE.MeshStandardMaterial({ color: 0x7a5a46, roughness: 0.74, metalness: 0.12, transparent: true, opacity: 0.7 });
    const railPoints = (this.effects.TC?.ballTrack || []).map(([x, y]) => this.topology.faceGridToLocal('TC', x, y, new THREE.Vector3()).addScaledVector(trackFace.n, 0.4));
    if (railPoints.length > 1) {
      const rail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(railPoints.concat([railPoints[0].clone()])),
        new THREE.LineBasicMaterial({ color: 0xc08a68, transparent: true, opacity: 0.65 })
      );
      this.effectMeshes.add(rail);
    }
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1.28, 22, 18),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, emissive: 0x12161c, emissiveIntensity: 0.12, roughness: 0.36, metalness: 0.82 })
    );
    ball.position.copy(railPoints[0] || new THREE.Vector3());
    this.effectMeshes.add(ball);
    this.hazardMeshes.balls.push({ mesh: ball, face: 'TC', points: railPoints });

    const hammerFace = this.faces.TD;
    for (const h of this.effects.TD?.hammers || []) {
      const base = this.topology.faceGridToLocal('TD', h.cell[0], h.cell[1], new THREE.Vector3()).addScaledVector(hammerFace.n, 0.8);
      const rig = new THREE.Group();
      rig.position.copy(base);
      rig.quaternion.setFromUnitVectors(UP, hammerFace.n);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), chainMat);
      pole.position.y = 2.1;
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.95, 1.2), headMat);
      head.position.y = 0.5;
      rig.add(pole, head);
      this.effectMeshes.add(rig);
      this.hazardMeshes.hammers.push({ mesh: rig, head, face: 'TD', phase: h.phase, baseY: base.y });
    }
  }

  _buildPellets() {
    this.registry = {};
    const dots = [];
    const powers = [];
    for (const id of this.faceIds) {
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
      const f = this.faces[id];
      this.topology.faceGridToLocal(id, x, y, pos).addScaledVector(f.n, 1.0);
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
      const f = this.faces[id];
      const p = this.topology.faceGridToLocal(id, x, y, new THREE.Vector3()).addScaledVector(f.n, 1.2);
      this._powerData.push({ idx: i, pos: p.clone() });
      dummy.position.copy(p); dummy.quaternion.identity(); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); powInst.setMatrixAt(i, dummy.matrix);
    });
    powInst.instanceMatrix.needsUpdate = true;
    this.powInst = powInst;
    this.group.add(powInst);
    this._dummy = dummy;
  }

  _gateOpen(faceId) {
    const fx = this.effects[faceId];
    if (!fx || fx.type !== 'gate') return true;
    const cycle = GATE_OPEN_TIME + GATE_CLOSED_TIME;
    const t = (this._time + fx.phase) % cycle;
    return t < GATE_OPEN_TIME;
  }

  isBlocked(faceId, x, y) {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return true;
    if (!this.topology.isCellUsable(faceId, x, y)) return true;
    if (this.data.faces[faceId].grid[y][x] !== PATH) return true;
    const fx = this.effects[faceId];
    if (fx?.type === 'gate' && fx.cells.has(this._cellKey(x, y)) && !this._gateOpen(faceId)) return true;
    return false;
  }

  isPassable(faceId, x, y) {
    return !this.isBlocked(faceId, x, y);
  }

  getEdgePortalEdge(faceId, x, y) {
    return this.topology.getEdgePortalEdge(faceId, x, y);
  }

  getSpeedMultiplier(faceId, u, v, du = 0, dv = 0) {
    const fx = this.effects[faceId];
    if (!fx) return 1;
    const key = this._cellKey(Math.round(u), Math.round(v));
    if (fx.type === 'mud') return fx.cells.has(key) ? 0.42 : 1;
    if (fx.type === 'speed') {
      for (const strip of fx.strips || []) if (strip.cells.has(key)) return 1.65;
      return 1;
    }
    return 1;
  }

  isHidden(faceId, u, v) {
    const fx = this.effects[faceId];
    if (!fx || fx.type !== 'sanctuary') return false;
    const key = this._cellKey(Math.round(u), Math.round(v));
    return (fx.sanctuaries || []).some(s => this._cellKey(s.cell[0], s.cell[1]) === key);
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
    for (const id of this.faceIds) {
      const f = this.faces[id];
      for (const e of this.edges) {
        const mid = this.topology.portalMids[e];
        const base = this.topology.faceGridToLocal(id, mid[0], mid[1], new THREE.Vector3());
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
    if (kind === 'ghost-eye') return this.topology.crossEdge(faceId, edge);
    const pairKey = this._edgePortalKey(faceId, edge);
    const state = this.edgePortalState.get(pairKey);
    if (state && state.cooldown > 0) return null;
    this.edgePortalState.set(pairKey, { cooldown: EDGE_PORTAL_COOLDOWN, by: kind });
    for (const tile of this.edgePortalTiles.get(pairKey) || []) {
      tile.material.color.setHex(0x1b2b20);
      tile.material.emissive.setHex(0x000000);
      tile.material.emissiveIntensity = 0.02;
    }
    return this.topology.crossEdge(faceId, edge);
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
    this._toQuat.copy(this.topology.canonQuat[faceId]);
    this._rotT = 0;
    this.rotating = true;
  }

  setTheme(theme) {
    for (const m of this.floorMats) m.envMapIntensity = 0.06;
    if (this.topology.kind === 'tetra') {
      for (const inst of Object.values(this.wallMeshes)) {
        const mat = inst.material;
        mat.emissiveIntensity = 0.18;
        mat.opacity = 0.56;
      }
    }
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

    for (const g of this.gateMeshes || []) {
      const open = this._gateOpen('NY');
      g.visible = true;
      const rise = open ? 0.02 : 1;
      g.scale.y += (rise - g.scale.y) * Math.min(1, dt * 8);
      if (!open) g.material.emissiveIntensity = 0.18 + 0.08 * Math.sin(this._time * 5);
    }

    for (const s of this.sanctuaryMeshes || []) {
      const pulse = 0.92 + 0.08 * Math.sin(this._time * 3.2);
      s.shell.scale.setScalar(pulse);
      s.shell.material.opacity = 0.2 + 0.05 * Math.sin(this._time * 2.4);
      s.ring.rotation.z -= dt * 0.8;
      s.ring.material.emissiveIntensity = 0.28 + 0.08 * Math.sin(this._time * 4.1);
      s.core.material.opacity = 0.45 + 0.08 * Math.sin(this._time * 5.3);
    }

    this._updateLevel2Hazards(dt);

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
      for (const id of this.faceIds) {
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
    this.topology.faceGridToLocal(faceId, u, v, out);
    return this.group.localToWorld(out);
  }

  _updateLevel2Hazards(dt) {
    if (this.topology.kind !== 'tetra') return;
    for (const p of this.hazardMeshes?.pendulums || []) {
      const swing = Math.sin((this._time + p.phase) * (Math.PI * 2 / PENDULUM_PERIOD)) * 0.72;
      p.mesh.rotation.z = swing;
      p.head.material.emissiveIntensity = 0.08 + 0.06 * Math.abs(swing);
    }
    for (const b of this.hazardMeshes?.balls || []) {
      if (!b.points.length) continue;
      const count = b.points.length;
      const t = ((this._time / IRONBALL_PERIOD) % 1) * count;
      const i0 = Math.floor(t) % count;
      const i1 = (i0 + 1) % count;
      const frac = t - Math.floor(t);
      b.mesh.position.copy(b.points[i0]).lerp(b.points[i1], frac);
      b.mesh.rotation.z += dt * 2.4;
      b.mesh.rotation.x += dt * 1.6;
    }
    for (const h of this.hazardMeshes?.hammers || []) {
      const cycle = (this._time + h.phase) % HAMMER_PERIOD;
      const strike = cycle < 0.6 ? 1 : cycle < 1.0 ? 0.12 : cycle < 2.0 ? 0.12 : 0.75;
      h.mesh.position.y += ((h.baseY - 0.4 + strike * 2.8) - h.mesh.position.y) * Math.min(1, dt * 12);
      h.mesh.rotation.z = cycle < 0.35 ? 0.08 : 0;
      h.head.material.emissiveIntensity = cycle < 0.45 ? 0.28 : 0.12;
    }
  }

  checkPlayerHazardHit(player) {
    if (this.topology.kind !== 'tetra') return false;
    const pp = player.getWorldPosition(new THREE.Vector3());
    for (const p of this.hazardMeshes?.pendulums || []) {
      if (player.face !== p.face) continue;
      if (pp.distanceTo(p.head.getWorldPosition(new THREE.Vector3())) < 2.1) return true;
    }
    for (const b of this.hazardMeshes?.balls || []) {
      if (player.face !== b.face) continue;
      if (pp.distanceTo(b.mesh.getWorldPosition(new THREE.Vector3())) < 2.6) return true;
    }
    for (const h of this.hazardMeshes?.hammers || []) {
      if (player.face !== h.face) continue;
      if (pp.distanceTo(h.head.getWorldPosition(new THREE.Vector3())) < 2.3) return true;
    }
    return false;
  }
}

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
