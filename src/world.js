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
  NY: 'classic',
  NZ: 'sanctuary'
};
const EDGE_PORTAL_COOLDOWN = 2.0;
const SINKING_BLOCK_RAISED_HOLD = 2.1;
const SINKING_BLOCK_LOWER_TIME = 0.9;
const SINKING_BLOCK_LOWER_HOLD = 1.8;
const SINKING_BLOCK_RAISE_TIME = 1.0;
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

function makeCosmeticPickupMesh(cosmetic) {
  const color = { hat: 0xffd24a, cape: 0xff5b7b, glasses: 0x53e0ff, crown: 0xffe08a }[cosmetic] || 0xffffff;
  const group = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.68, 0),
    new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.25 })
  );
  gem.position.y = 0.95;
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.62, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: 0x223047, emissive: 0x0c1524, emissiveIntensity: 0.3, roughness: 0.5 })
  );
  group.add(gem, pedestal);
  return group;
}

function makeShieldPickupMesh() {
  const group = new THREE.Group();
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.66, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0x8dff9b, emissive: 0x2ecb74, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85 })
  );
  orb.position.y = 0.95;
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.62, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: 0x1f3a2a, emissive: 0x0c241a, emissiveIntensity: 0.3, roughness: 0.5 })
  );
  group.add(orb, pedestal);
  return group;
}

export class World {
  constructor(scene, worldData, spec) {
    this.scene = scene;
    this.data = worldData;
    this.spec = spec;
    this.topology = spec.topology;
    this.mechanicSet = spec.mechanicSet || 'level1';
    this.isLevel2 = this.mechanicSet === 'level2';
    this.isRoute = this.mechanicSet !== 'level1';
    this.hasSurfaces = this.isLevel2;
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
    this._buildRewards();
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
    if (this.isLevel2) {
      for (const id of this.faceIds) this.effects[id] = { type: 'classic' };
      this._initLevel2Effects();
      return;
    }
    const plan = FACE_EFFECT_PLAN;
    for (const id of this.faceIds) this.effects[id] = { type: plan[id] || 'classic' };

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

    // NY: a few existing wall blocks periodically sink to open temporary routes.
    {
      const faceId = 'NY';
      const grid = this.data.faces[faceId].grid;
      const candidates = [];
      const protectedCells = [[0, MID], [GRID - 1, MID], [MID, 0], [MID, GRID - 1], [MID, MID]];
      const isProtected = (x, y) => protectedCells.some(([px, py]) => Math.abs(px - x) + Math.abs(py - y) <= 2);
      for (let y = 1; y < GRID - 1; y++) {
        for (let x = 1; x < GRID - 1; x++) {
          if (grid[y][x] !== 0) continue;
          if (isProtected(x, y)) continue;
          const horizontal = grid[y][x - 1] === PATH && grid[y][x + 1] === PATH;
          const vertical = grid[y - 1][x] === PATH && grid[y + 1][x] === PATH;
          if (!horizontal && !vertical) continue;
          candidates.push({ cell: [x, y], axis: horizontal ? 'h' : 'v' });
        }
      }
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      const chosen = candidates.slice(0, Math.min(5, candidates.length)).map((c, index) => ({
        ...c,
        phase: index * 0.85 + Math.random() * 0.25,
        progress: 1,
        lastPassable: false,
        mesh: null,
        basePos: null
      }));
      this.effects[faceId].dynamicBlocks = chosen;
      this.effects[faceId].dynamicBlockMap = new Map(chosen.map(block => [this._cellKey(block.cell[0], block.cell[1]), block]));
    }
  }

  _initLevel2Effects() {
    // Three damage faces + surface faces, plus a mixed hard start face (PY).
    // Spinners = vertical windmills (360° in a vertical plane; dangerous at bottom).
    this.effects.PX.spinners = [
      { mid: [2, MID], axis: 'h', phase: 0.0 },
      { mid: [GRID - 3, MID], axis: 'h', phase: 1.5 },
      { mid: [MID, 2], axis: 'v', phase: 0.7 },
      { mid: [MID, GRID - 3], axis: 'v', phase: 2.2 }
    ];

    // A heavy ball rolls the outer ring loop of PZ.
    this.effects.PZ.ballTrack = [
      [1, 1], [MID, 1], [GRID - 2, 1], [GRID - 2, MID],
      [GRID - 2, GRID - 2], [MID, GRID - 2], [1, GRID - 2], [1, MID]
    ];

    // Hammers pound the corridors of NX.
    this.effects.NX.hammers = [
      { cell: [MID, 3], phase: 0.3 },
      { cell: [MID, GRID - 4], phase: 1.5 },
      { cell: [3, MID], phase: 2.2 }
    ];

    // NY: a full sheet of ice with only a few non-ice footholds (center + arms).
    {
      const grid = this.data.faces.NY.grid;
      const footholds = new Set([[MID, MID], [1, MID], [GRID - 2, MID], [MID, 1], [MID, GRID - 2]].map(([x, y]) => this._cellKey(x, y)));
      const ice = new Set();
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (grid[y][x] === PATH && !footholds.has(this._cellKey(x, y))) ice.add(this._cellKey(x, y));
      }
      this.effects.NY.iceCells = ice;
    }

    // NZ: a conveyor playground — a clockwise ring current plus cross-arm belts.
    {
      const conv = new Map();
      for (let i = 1; i <= GRID - 2; i++) {
        conv.set(this._cellKey(i, MID), [1, 0]);        // horizontal arm -> right
        conv.set(this._cellKey(MID, i), [0, 1]);        // vertical arm -> down
        conv.set(this._cellKey(i, 1), [1, 0]);          // ring top -> right
        conv.set(this._cellKey(GRID - 2, i), [0, 1]);   // ring right -> down
        conv.set(this._cellKey(i, GRID - 2), [-1, 0]);  // ring bottom -> left
        conv.set(this._cellKey(1, i), [0, -1]);         // ring left -> up
      }
      this.effects.NZ.conveyorCells = conv;
    }

    // PY: mixed hard start — ice on the left arm, a conveyor on the right arm, and
    // a pounding hammer on the bottom arm. Center spawn + top arm stay clear.
    {
      const ice = new Set();
      for (let x = 1; x < MID; x++) ice.add(this._cellKey(x, MID));
      this.effects.PY.iceCells = ice;
      const conv = new Map();
      for (let x = MID + 1; x <= GRID - 2; x++) conv.set(this._cellKey(x, MID), [1, 0]);
      this.effects.PY.conveyorCells = conv;
      this.effects.PY.hammers = [{ cell: [MID, GRID - 3], phase: 0.6 }];
    }

    // Optional risk/reward pickups (dot removed -> not required to clear).
    const rewardPlan = {
      PY: [{ cell: [MID, 1], kind: 'cosmetic', cosmetic: 'hat' }],
      PX: [{ cell: [MID, GRID - 3], kind: 'cosmetic', cosmetic: 'cape' }],
      PZ: [{ cell: [GRID - 2, MID], kind: 'cosmetic', cosmetic: 'glasses' }],
      NX: [
        { cell: [MID, 3], kind: 'cosmetic', cosmetic: 'crown' },
        { cell: [MID, GRID - 4], kind: 'shield' }
      ]
    };
    for (const faceId of this.faceIds) {
      const rewards = [];
      for (const r of rewardPlan[faceId] || []) {
        const [x, y] = r.cell;
        const pellets = this.data.faces[faceId].pellets;
        if (pellets[y] && pellets[y][x] !== 0) {
          pellets[y][x] = 0;
          this.data.faces[faceId].dotCount--;
          this.data.totalDots--;
        }
        rewards.push({ ...r });
      }
      this.effects[faceId].rewards = rewards;
    }
  }

  getSurface(faceId, u, v) {
    const fx = this.effects[faceId];
    if (!fx) return { ice: false, conveyor: null };
    const key = this._cellKey(Math.round(u), Math.round(v));
    return {
      ice: fx.iceCells ? fx.iceCells.has(key) : false,
      conveyor: fx.conveyorCells ? (fx.conveyorCells.get(key) || null) : null
    };
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
        emissiveIntensity: 0.1
      });
      this.floorMats.push(mat);
      const geo = new THREE.BoxGeometry(GRID * CELL, 0.6, GRID * CELL);
      const m = new THREE.Mesh(geo, mat);
      const f = this.faces[id];
      m.position.copy(f.n).multiplyScalar(HALF - 0.3);
      m.quaternion.setFromUnitVectors(UP, f.n);
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
    this.wallCellIndex = {};
    const dummy = new THREE.Object3D();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();

    for (const id of this.faceIds) {
      const g = this.data.faces[id].grid;
      const dynamicMap = this.effects[id]?.dynamicBlockMap;
      const count = this._countCells((faceId, x, y, grid) => faceId === id && grid[y][x] === 0 && !dynamicMap?.has(this._cellKey(x, y)));
      const style = FACE_STYLES[this.faceIds.indexOf(id) % FACE_STYLES.length];
      const tint = new THREE.Color(style.wallTint);
      const wallMap = this.isRoute ? makePrismWallTexture(style.wallTint) : null;
      const mat = new THREE.MeshStandardMaterial({
        map: wallMap,
        color: tint,
        roughness: 0.82,
        metalness: 0.02,
        envMapIntensity: 0.08,
        emissive: tint.clone().multiplyScalar(0.12),
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: this.isRoute ? 0.5 : 0.42,
        depthWrite: false
      });
      const inst = new THREE.InstancedMesh(geo, mat, count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      const f = this.faces[id];
      q.setFromUnitVectors(UP, f.n);
      this.wallCellIndex[id] = {};
      let i = 0;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (g[y][x] !== 0) continue;
        if (dynamicMap?.has(this._cellKey(x, y))) continue;
        this.topology.faceGridToLocal(id, x, y, pos);
        pos.addScaledVector(f.n, WALL_HEIGHT / 2);
        dummy.position.copy(pos);
        dummy.quaternion.copy(q);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.wallCellIndex[id][this._cellKey(x, y)] = i;
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
    if (this.isLevel2) {
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

    // NY dynamic sinking blocks reuse the existing wall language.
    this.dynamicBlockMeshes = [];
    const nyStyle = FACE_STYLES[this.faceIds.indexOf('NY') % FACE_STYLES.length];
    const blockMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(nyStyle.wallTint),
      roughness: 0.8,
      metalness: 0.04,
      envMapIntensity: 0.08,
      emissive: new THREE.Color(nyStyle.wallTint).multiplyScalar(0.12),
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    const blockGeo = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
    for (const block of this.effects.NY?.dynamicBlocks || []) {
      const [x, y] = block.cell;
      const f = this.faces.NY;
      const base = this.topology.faceGridToLocal('NY', x, y, new THREE.Vector3());
      const mesh = new THREE.Mesh(blockGeo, blockMat.clone());
      mesh.quaternion.setFromUnitVectors(UP, f.n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.effectMeshes.add(mesh);
      block.mesh = mesh;
      block.basePos = base;
      this.dynamicBlockMeshes.push(block);
    }

    this.group.add(this.effectMeshes);
  }

  _buildLevel2Effects() {
    this.hazardMeshes = { spinners: [], balls: [], hammers: [] };
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x3a3d46, roughness: 0.42, metalness: 0.75 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1e25, emissive: 0x080b10, emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.86 });

    // Windmill hammers: a rigid arm + ball rotating 360° in a VERTICAL plane about a
    // hub raised above the floor. The ball is at player height at the bottom of its
    // circle (deadly) and lifts overhead (safe) — cross when it is up.
    const ARM = 4;
    const HUB_H = 5.0; // ball bottom sits at ~HUB_H - ARM = 1.0 above the floor
    for (const faceId of this.faceIds) {
      const face = this.faces[faceId];
      for (const s of this.effects[faceId]?.spinners || []) {
        const armDir = s.axis === 'h' ? face.r : face.u;
        const hubPos = this.topology.faceGridToLocal(faceId, s.mid[0], s.mid[1], new THREE.Vector3()).addScaledVector(face.n, HUB_H);
        const pivot = new THREE.Group();
        pivot.position.copy(hubPos);
        const zAxis = new THREE.Vector3().crossVectors(armDir, face.n);
        pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(armDir, face.n, zAxis));
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, ARM, 8), chainMat);
        arm.position.y = -ARM / 2;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), headMat);
        head.scale.set(1.15, 1.15, 1.15);
        head.position.y = -ARM;
        pivot.add(arm, head);
        this.effectMeshes.add(pivot);
        this.hazardMeshes.spinners.push({ mesh: pivot, head, face: faceId, phase: s.phase });
      }
    }

    // Rolling ball on the PZ ring loop.
    const trackFace = this.faces.PZ;
    const railPoints = (this.effects.PZ?.ballTrack || []).map(([x, y]) => this.topology.faceGridToLocal('PZ', x, y, new THREE.Vector3()).addScaledVector(trackFace.n, 1.0));
    if (railPoints.length > 1) {
      const rail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(railPoints.concat([railPoints[0].clone()])),
        new THREE.LineBasicMaterial({ color: 0xc08a68, transparent: true, opacity: 0.6 })
      );
      this.effectMeshes.add(rail);
    }
    if (railPoints.length) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1.28, 22, 18),
        new THREE.MeshStandardMaterial({ color: 0x2b2f36, emissive: 0x12161c, emissiveIntensity: 0.12, roughness: 0.36, metalness: 0.82 })
      );
      ball.position.copy(railPoints[0]);
      this.effectMeshes.add(ball);
      this.hazardMeshes.balls.push({ mesh: ball, face: 'PZ', points: railPoints });
    }

    // Pounding hammers (any face that declares them).
    for (const faceId of this.faceIds) {
      const hammerFace = this.faces[faceId];
      for (const h of this.effects[faceId]?.hammers || []) {
        const base = this.topology.faceGridToLocal(faceId, h.cell[0], h.cell[1], new THREE.Vector3()).addScaledVector(hammerFace.n, 0.8);
        const rig = new THREE.Group();
        rig.position.copy(base);
        rig.quaternion.setFromUnitVectors(UP, hammerFace.n);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), chainMat);
        pole.position.y = 2.1;
        const head = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.95, 1.2), headMat);
        head.position.y = 0.5;
        rig.add(pole, head);
        this.effectMeshes.add(rig);
        this.hazardMeshes.hammers.push({ mesh: rig, head, face: faceId, phase: h.phase, base: base.clone(), normal: hammerFace.n.clone() });
      }
    }

    this._buildSurfaceTiles();
  }

  _buildSurfaceTiles() {
    // Ice = pale-blue translucent tiles; conveyors = colored tiles with an arrow.
    const iceGeo = new THREE.BoxGeometry(CELL * 0.94, 0.12, CELL * 0.94);
    const convGeo = new THREE.BoxGeometry(CELL * 0.94, 0.12, CELL * 0.94);
    for (const id of this.faceIds) {
      const fx = this.effects[id];
      if (!fx) continue;
      const f = this.faces[id];
      const q = new THREE.Quaternion().setFromUnitVectors(UP, f.n);
      for (const key of fx.iceCells || []) {
        const [x, y] = key.split(':').map(Number);
        const tile = new THREE.Mesh(iceGeo, new THREE.MeshStandardMaterial({
          color: 0xbfefff, emissive: new THREE.Color(0x8fd8ff), emissiveIntensity: 0.22,
          roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.5
        }));
        tile.position.copy(this.topology.faceGridToLocal(id, x, y, new THREE.Vector3())).addScaledVector(f.n, 0.08);
        tile.quaternion.copy(q);
        this.effectMeshes.add(tile);
      }
      for (const [key, dir] of fx.conveyorCells || new Map()) {
        const [x, y] = key.split(':').map(Number);
        const base = this.topology.faceGridToLocal(id, x, y, new THREE.Vector3());
        const tile = new THREE.Mesh(convGeo, new THREE.MeshStandardMaterial({
          color: 0x3b5170, emissive: new THREE.Color(0xffa53b), emissiveIntensity: 0.18,
          roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.72
        }));
        tile.position.copy(base).addScaledVector(f.n, 0.07);
        tile.quaternion.copy(q);
        this.effectMeshes.add(tile);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 8), new THREE.MeshStandardMaterial({
          color: 0xffd24a, emissive: new THREE.Color(0xffa53b), emissiveIntensity: 0.6, roughness: 0.3
        }));
        const dirWorld = new THREE.Vector3().addScaledVector(f.r, dir[0]).addScaledVector(f.u, dir[1]).normalize();
        arrow.position.copy(base).addScaledVector(f.n, 0.5);
        arrow.quaternion.setFromUnitVectors(UP, dirWorld);
        this.effectMeshes.add(arrow);
      }
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

  isBlocked(faceId, x, y) {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return true;
    if (!this.topology.isCellUsable(faceId, x, y)) return true;
    if (this.data.faces[faceId].grid[y][x] !== PATH) {
      const block = this.effects[faceId]?.dynamicBlockMap?.get(this._cellKey(x, y));
      if (!block) return true;
      return this._dynamicBlockProgress(block) > 0.18;
    }
    return false;
  }

  isPassable(faceId, x, y) {
    return !this.isBlocked(faceId, x, y);
  }

  getEdgePortalEdge(faceId, x, y) {
    return this.topology.getEdgePortalEdge(faceId, x, y);
  }

  isFacePortalCoolingDown(faceId, edge) {
    const pairKey = this._edgePortalKey(faceId, edge);
    const state = this.edgePortalState.get(pairKey);
    return !!(state && state.cooldown > 0);
  }

  _dynamicBlockProgress(block) {
    const cycle = SINKING_BLOCK_RAISED_HOLD + SINKING_BLOCK_LOWER_TIME + SINKING_BLOCK_LOWER_HOLD + SINKING_BLOCK_RAISE_TIME;
    let t = (this._time + block.phase) % cycle;
    if (t < SINKING_BLOCK_RAISED_HOLD) return 1;
    t -= SINKING_BLOCK_RAISED_HOLD;
    if (t < SINKING_BLOCK_LOWER_TIME) return 1 - (t / SINKING_BLOCK_LOWER_TIME);
    t -= SINKING_BLOCK_LOWER_TIME;
    if (t < SINKING_BLOCK_LOWER_HOLD) return 0;
    t -= SINKING_BLOCK_LOWER_HOLD;
    return Math.min(1, t / SINKING_BLOCK_RAISE_TIME);
  }

  _findDisplacementCell(faceId, x, y, refU, refV) {
    const candidates = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.isPassable(faceId, nx, ny)) continue;
      candidates.push({ x: nx, y: ny, score: (refU - nx) ** 2 + (refV - ny) ** 2 });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }

  _displacePlayer(player, target) {
    player.u = target.x;
    player.v = target.y;
    player.syncTransform();
  }

  _displaceGhost(ghost, target) {
    ghost.cx = target.x;
    ghost.cy = target.y;
    ghost.next = [target.x, target.y];
    ghost.t = 0;
    if (typeof ghost._pickInitialDir === 'function') ghost._pickInitialDir();
    ghost.syncTransform(0);
  }

  _displaceActorsForBlock(block, player, ghosts) {
    const [x, y] = block.cell;
    if (player && player.face === 'NY' && Math.abs(player.u - x) < 0.45 && Math.abs(player.v - y) < 0.45) {
      const target = this._findDisplacementCell('NY', x, y, player.u, player.v);
      if (target) this._displacePlayer(player, target);
    }
    for (const ghost of ghosts || []) {
      if (ghost.face !== 'NY') continue;
      const gu = ghost.cx + (ghost.next[0] - ghost.cx) * ghost.t;
      const gv = ghost.cy + (ghost.next[1] - ghost.cy) * ghost.t;
      if (Math.abs(gu - x) < 0.4 && Math.abs(gv - y) < 0.4) {
        const target = this._findDisplacementCell('NY', x, y, gu, gv);
        if (target) this._displaceGhost(ghost, target);
      }
    }
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

  _buildRewards() {
    this.rewardRegistry = {};
    this.rewardMeshes = [];
    for (const faceId of this.faceIds) {
      const reg = {};
      this.rewardRegistry[faceId] = reg;
      const f = this.faces[faceId];
      for (const r of this.effects[faceId]?.rewards || []) {
        const [x, y] = r.cell;
        const base = this.topology.faceGridToLocal(faceId, x, y, new THREE.Vector3());
        const group = new THREE.Group();
        group.position.copy(base).addScaledVector(f.n, 1.4);
        group.quaternion.setFromUnitVectors(UP, f.n);
        group.add(r.kind === 'shield' ? makeShieldPickupMesh() : makeCosmeticPickupMesh(r.cosmetic));
        this.effectMeshes.add(group);
        const entry = { ...r, taken: false, group };
        reg[this._cellKey(x, y)] = entry;
        this.rewardMeshes.push(entry);
      }
    }
  }

  collectRewardAt(faceId, x, y) {
    const reg = this.rewardRegistry?.[faceId];
    if (!reg) return null;
    const entry = reg[this._cellKey(x, y)];
    if (!entry || entry.taken) return null;
    entry.taken = true;
    entry.group.visible = false;
    return entry;
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
    if (this.isRoute) {
      for (const inst of Object.values(this.wallMeshes)) {
        const mat = inst.material;
        mat.emissiveIntensity = 0.18;
        mat.opacity = 0.5;
      }
    }
  }

  update(dt, player = null, ghosts = []) {
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

    for (const s of this.sanctuaryMeshes || []) {
      const pulse = 0.92 + 0.08 * Math.sin(this._time * 3.2);
      s.shell.scale.setScalar(pulse);
      s.shell.material.opacity = 0.2 + 0.05 * Math.sin(this._time * 2.4);
      s.ring.rotation.z -= dt * 0.8;
      s.ring.material.emissiveIntensity = 0.28 + 0.08 * Math.sin(this._time * 4.1);
      s.core.material.opacity = 0.45 + 0.08 * Math.sin(this._time * 5.3);
    }

    for (const block of this.dynamicBlockMeshes || []) {
      const prevPassable = block.lastPassable;
      const progress = this._dynamicBlockProgress(block);
      const scaleY = 0.02 + progress * 0.98;
      block.progress = progress;
      block.mesh.scale.set(1, scaleY, 1);
      block.mesh.position.copy(block.basePos).addScaledVector(this.faces.NY.n, WALL_HEIGHT * scaleY * 0.5);
      block.mesh.material.emissiveIntensity = 0.08 + progress * 0.1;
      const passable = progress <= 0.18;
      if (prevPassable && !passable) this._displaceActorsForBlock(block, player, ghosts);
      block.lastPassable = passable;
    }

    this._updateLevel2Hazards(dt);

    for (const r of this.rewardMeshes || []) {
      if (r.taken) continue;
      const spin = r.group.children[0];
      if (spin) {
        spin.rotation.y += dt * 1.6;
        spin.position.y = 0.15 * Math.sin(this._time * 2.4 + (r.cell[0] + r.cell[1]));
      }
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
    if (!this.isLevel2) return;
    const spinOmega = Math.PI * 2 / 2.8;
    for (const s of this.hazardMeshes?.spinners || []) {
      s.mesh.rotation.z = (this._time + s.phase) * spinOmega;
      s.head.material.emissiveIntensity = 0.16;
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
      // raised (safe) most of the cycle, then a quick slam down.
      const lift = cycle < 0.55 ? 0.15 : cycle < 1.0 ? 2.8 * ((cycle - 0.55) / 0.45) : 2.8;
      h.mesh.position.copy(h.base).addScaledVector(h.normal, lift);
      h.head.material.emissiveIntensity = cycle < 0.55 ? 0.3 : 0.12;
    }
  }

  checkPlayerHazardHit(player) {
    if (!this.isLevel2) return false;
    const pp = player.getWorldPosition(new THREE.Vector3());
    for (const s of this.hazardMeshes?.spinners || []) {
      if (player.face !== s.face) continue;
      if (pp.distanceTo(s.head.getWorldPosition(new THREE.Vector3())) < 2.0) return true;
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
