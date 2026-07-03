import * as THREE from 'three';
import { GRID, MID, CELL, HALF } from './config.js';

const RAW_NORMALS = {
  TA: new THREE.Vector3(1, 1, 1),
  TB: new THREE.Vector3(-1, 1, -1),
  TC: new THREE.Vector3(1, -1, -1),
  TD: new THREE.Vector3(-1, -1, 1)
};

const EDGE_MIDS = {
  L: [0, MID],
  R: [GRID - 1, MID],
  T: [MID, 0]
};

function makeFace(id, normal) {
  const n = normal.clone().normalize();
  const helper = Math.abs(n.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(helper, n).normalize();
  const u = new THREE.Vector3().crossVectors(n, r).normalize();
  return {
    id,
    n,
    r,
    u,
    normal: [n.x, n.y, n.z],
    right: [r.x, r.y, r.z],
    up: [u.x, u.y, u.z]
  };
}

export const TETRA_FACES = {
  TA: makeFace('TA', RAW_NORMALS.TA),
  TB: makeFace('TB', RAW_NORMALS.TB),
  TC: makeFace('TC', RAW_NORMALS.TC),
  TD: makeFace('TD', RAW_NORMALS.TD)
};

export const TETRA_FACE_IDS = Object.keys(TETRA_FACES);
export const TETRA_EDGES = ['L', 'R', 'T'];

const WX = new THREE.Vector3(1, 0, 0);
const WYNEGZ = new THREE.Vector3(0, 0, -1);
const WY = new THREE.Vector3(0, 1, 0);

function canonicalQuaternion(faceId, out = new THREE.Quaternion()) {
  const f = TETRA_FACES[faceId];
  const a = new THREE.Matrix4().makeBasis(f.r, f.u, f.n);
  const b = new THREE.Matrix4().makeBasis(WX, WYNEGZ, WY);
  const R = b.clone().multiply(a.clone().transpose());
  out.setFromRotationMatrix(R);
  return out;
}

const CANON = {};
for (const id of TETRA_FACE_IDS) CANON[id] = canonicalQuaternion(id);

const TRANSITIONS = {
  'TA:L': { face: 'TB', edge: 'R', heading: [-1, 0] },
  'TA:R': { face: 'TC', edge: 'L', heading: [1, 0] },
  'TA:T': { face: 'TD', edge: 'T', heading: [0, 1] },
  'TB:L': { face: 'TD', edge: 'R', heading: [-1, 0] },
  'TB:R': { face: 'TA', edge: 'L', heading: [1, 0] },
  'TB:T': { face: 'TC', edge: 'T', heading: [0, 1] },
  'TC:L': { face: 'TA', edge: 'R', heading: [-1, 0] },
  'TC:R': { face: 'TD', edge: 'L', heading: [1, 0] },
  'TC:T': { face: 'TB', edge: 'T', heading: [0, 1] },
  'TD:L': { face: 'TC', edge: 'R', heading: [-1, 0] },
  'TD:R': { face: 'TB', edge: 'L', heading: [1, 0] },
  'TD:T': { face: 'TA', edge: 'T', heading: [0, 1] }
};

const ADJ = {};
for (const id of TETRA_FACE_IDS) ADJ[id] = {};
for (const [key, value] of Object.entries(TRANSITIONS)) {
  const [face, edge] = key.split(':');
  ADJ[face][edge] = value.face;
}

const NEXT_HOP = {};
for (const from of TETRA_FACE_IDS) {
  NEXT_HOP[from] = {};
  for (const to of TETRA_FACE_IDS) {
    if (from === to) {
      NEXT_HOP[from][to] = null;
      continue;
    }
    const direct = Object.entries(ADJ[from]).find(([, face]) => face === to);
    NEXT_HOP[from][to] = direct ? direct[0] : null;
  }
}

function faceGridToLocal(faceId, x, y, out = new THREE.Vector3()) {
  const f = TETRA_FACES[faceId];
  const uPos = (x - MID) * CELL * 0.9;
  const vPos = (y - MID * 0.66) * CELL * 0.96;
  out.copy(f.n).multiplyScalar(HALF);
  out.addScaledVector(f.r, uPos);
  out.addScaledVector(f.u, -vPos);
  return out;
}

function crossEdge(faceId, edge) {
  const tx = TRANSITIONS[`${faceId}:${edge}`];
  if (!tx) return null;
  return { face: tx.face, edge: tx.edge, cell: EDGE_MIDS[tx.edge].slice(), heading: tx.heading.slice() };
}

function getEdgePortalEdge(_faceId, x, y) {
  if (x === 0 && y === MID) return 'L';
  if (x === GRID - 1 && y === MID) return 'R';
  if (x === MID && y === 0) return 'T';
  return null;
}

function detectExit(_faceId, u, v) {
  if (u < -0.5 && Math.abs(v - MID) < 0.7) return 'L';
  if (u > GRID - 1 + 0.5 && Math.abs(v - MID) < 0.7) return 'R';
  if (v < -0.5 && Math.abs(u - MID) < 0.7) return 'T';
  return null;
}

function isCellUsable(_faceId, x, y) {
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return false;
  return y <= MID && Math.abs(x - MID) <= y;
}

function makeMiniLocal(faceId, u, v, lift, out = new THREE.Vector3()) {
  const f = TETRA_FACES[faceId];
  const uu = (u - MID) * 0.08;
  const vv = (v - MID * 0.66) * 0.085;
  out.copy(f.n).multiplyScalar(0.58 + lift);
  out.addScaledVector(f.r, uu);
  out.addScaledVector(f.u, -vv);
  return out;
}

export const tetraTopology = {
  kind: 'tetra',
  name: 'Tetrahedron',
  grid: GRID,
  mid: MID,
  faceIds: TETRA_FACE_IDS,
  faces: TETRA_FACES,
  edges: TETRA_EDGES,
  faceAdj: ADJ,
  faceNextHop: NEXT_HOP,
  canonQuat: CANON,
  faceGridToLocal,
  crossEdge,
  getEdgePortalEdge,
  detectExit,
  isCellUsable,
  portalMids: EDGE_MIDS,
  faceShape: 'triangle',
  startFace: 'TA',
  ghostFaces: ['TB', 'TC', 'TD', 'TB'],
  miniLocal: makeMiniLocal
};
