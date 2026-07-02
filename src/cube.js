// Cube topology, coordinate transforms, portal crossing, and per-face canonical
// world orientations. This module has NO Three.js scene dependencies beyond the
// math classes, so it can be unit-tested in Node.
import * as THREE from 'three';
import { GRID, MID, CELL, HALF } from './config.js';

// Six faces identified by their outward normal (in cube-local space).
// For each face we define an orthonormal frame (right = +u, up = +v, normal),
// chosen so that right = up x normal ... actually right x up = normal (right handed).
export const FACES = {
  PX: { normal: [ 1, 0, 0], right: [ 0, 0,-1], up: [0, 1, 0] },
  NX: { normal: [-1, 0, 0], right: [ 0, 0, 1], up: [0, 1, 0] },
  PY: { normal: [ 0, 1, 0], right: [ 1, 0, 0], up: [0, 0,-1] },
  NY: { normal: [ 0,-1, 0], right: [ 1, 0, 0], up: [0, 0, 1] },
  PZ: { normal: [ 0, 0, 1], right: [ 1, 0, 0], up: [0, 1, 0] },
  NZ: { normal: [ 0, 0,-1], right: [-1, 0, 0], up: [0, 1, 0] }
};

export const FACE_IDS = Object.keys(FACES);

// Convert stored arrays into THREE.Vector3 for convenience.
for (const id of FACE_IDS) {
  const f = FACES[id];
  f.id = id;
  f.n = new THREE.Vector3(...f.normal);
  f.r = new THREE.Vector3(...f.right);
  f.u = new THREE.Vector3(...f.up);
}

const EPS = 1e-6;

export function faceByNormal(v) {
  for (const id of FACE_IDS) {
    if (FACES[id].n.distanceToSquared(v) < EPS) return id;
  }
  return null;
}

// Edges of a face expressed in local (u,v) grid space.
// R:+u  L:-u  T:+v  B:-v. Each has an outward local direction and neighbour normal.
export const EDGES = ['R', 'L', 'T', 'B'];

export function edgeInfo(faceId, edge) {
  const f = FACES[faceId];
  switch (edge) {
    case 'R': return { neighborNormal: f.r.clone(),                 outward: f.r.clone(),                 mid: [GRID - 1, MID] };
    case 'L': return { neighborNormal: f.r.clone().multiplyScalar(-1), outward: f.r.clone().multiplyScalar(-1), mid: [0, MID] };
    case 'T': return { neighborNormal: f.u.clone(),                 outward: f.u.clone(),                 mid: [MID, GRID - 1] };
    case 'B': return { neighborNormal: f.u.clone().multiplyScalar(-1), outward: f.u.clone().multiplyScalar(-1), mid: [MID, 0] };
  }
}

// Which edge of `faceId` borders the face with the given normal (or null).
export function edgeTowardNormal(faceId, normalVec) {
  for (const e of EDGES) {
    if (edgeInfo(faceId, e).neighborNormal.distanceToSquared(normalVec) < EPS) return e;
  }
  return null;
}

// Crossing: leaving `faceId` through `edge`. Returns the arrival descriptor on the
// neighbouring face: which face, which entry edge, the entry cell (midpoint) and the
// inward heading (unit vector in that face's (u,v) grid, i.e. dc = [du, dv]).
export function crossEdge(faceId, edge) {
  const f = FACES[faceId];
  const info = edgeInfo(faceId, edge);
  const neighborId = faceByNormal(info.neighborNormal);
  const entryEdge = edgeTowardNormal(neighborId, f.n); // the edge of neighbour that faces back to us
  const g = FACES[neighborId];
  const entry = edgeInfo(neighborId, entryEdge);
  // Inward heading = opposite of the entry edge's outward direction, expressed in grid steps.
  let du = 0, dv = 0;
  switch (entryEdge) {
    case 'R': du = -1; break;   // entered from right edge -> move left (decreasing u)
    case 'L': du =  1; break;
    case 'T': dv = -1; break;
    case 'B': dv =  1; break;
  }
  return { face: neighborId, edge: entryEdge, cell: entry.mid.slice(), heading: [du, dv] };
}

// Local 3D position (in cube-local space) of a point on a face given continuous
// grid coordinates (u,v) where 0..GRID-1 map to cell centres.
export function faceGridToLocal(faceId, u, v, out = new THREE.Vector3()) {
  const f = FACES[faceId];
  const uPos = (u - (GRID - 1) / 2) * CELL;
  const vPos = (v - (GRID - 1) / 2) * CELL;
  out.copy(f.n).multiplyScalar(HALF);
  out.addScaledVector(f.r, uPos);
  out.addScaledVector(f.u, vPos);
  return out;
}

// Canonical world orientation (quaternion) that makes `faceId` the top face:
// normal -> +Y, face-up (v axis) -> -Z (world forward), face-right -> +X.
const _mA = new THREE.Matrix4();
const _mB = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const WX = new THREE.Vector3(1, 0, 0);
const WYneg_Z = new THREE.Vector3(0, 0, -1);
const WY = new THREE.Vector3(0, 1, 0);

export function canonicalQuaternion(faceId, out = new THREE.Quaternion()) {
  const f = FACES[faceId];
  // A: local basis (r, u, n) as columns.  B: target world basis (+X, -Z, +Y).
  _mA.makeBasis(f.r, f.u, f.n);
  _mB.makeBasis(WX, WYneg_Z, WY);
  // We want R * A = B  ->  R = B * A^T (A orthonormal).
  const at = _mA.clone().transpose();
  const R = _mB.clone().multiply(at);
  out.setFromRotationMatrix(R);
  return out;
}

// Precompute canonical quaternions once.
export const CANON_QUAT = {};
for (const id of FACE_IDS) CANON_QUAT[id] = canonicalQuaternion(id);

// Face adjacency graph (face -> {edge -> neighbourFaceId}) and BFS next-hop table
// used by ghosts to route across faces toward the player's face.
export const FACE_ADJ = {};
for (const id of FACE_IDS) {
  FACE_ADJ[id] = {};
  for (const e of EDGES) {
    FACE_ADJ[id][e] = faceByNormal(edgeInfo(id, e).neighborNormal);
  }
}

// nextHop[from][to] = edge to take from `from` to move one step toward `to`.
export const FACE_NEXT_HOP = {};
for (const from of FACE_IDS) {
  FACE_NEXT_HOP[from] = {};
  // BFS
  const prevEdge = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of EDGES) {
      const nb = FACE_ADJ[cur][e];
      if (!(nb in prevEdge)) {
        prevEdge[nb] = { via: cur, edge: cur === from ? e : prevEdge[cur].firstEdge, firstEdge: cur === from ? e : prevEdge[cur].firstEdge };
        queue.push(nb);
      }
    }
  }
  for (const to of FACE_IDS) {
    FACE_NEXT_HOP[from][to] = to === from ? null : prevEdge[to].firstEdge;
  }
}
