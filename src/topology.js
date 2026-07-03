import {
  FACE_IDS as CUBE_FACE_IDS,
  FACES as CUBE_FACES,
  FACE_ADJ as CUBE_FACE_ADJ,
  FACE_NEXT_HOP as CUBE_FACE_NEXT_HOP,
  CANON_QUAT as CUBE_CANON_QUAT,
  EDGES as CUBE_EDGES,
  faceGridToLocal as cubeFaceGridToLocal,
  crossEdge as cubeCrossEdge,
  edgeInfo
} from './cube.js';
import { GRID, MID } from './config.js';

function cubeGetEdgePortalEdge(_faceId, x, y) {
  if (x === 0 && y === MID) return 'L';
  if (x === GRID - 1 && y === MID) return 'R';
  if (x === MID && y === 0) return 'B';
  if (x === MID && y === GRID - 1) return 'T';
  return null;
}

function cubeDetectExit(_faceId, u, v) {
  if (u > GRID - 1 + 0.5 && Math.abs(v - MID) < 0.7) return 'R';
  if (u < -0.5 && Math.abs(v - MID) < 0.7) return 'L';
  if (v > GRID - 1 + 0.5 && Math.abs(u - MID) < 0.7) return 'T';
  if (v < -0.5 && Math.abs(u - MID) < 0.7) return 'B';
  return null;
}

function cubeIsCellUsable(_faceId, x, y) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}

function cubeMiniLocal(faceId, u, v, lift, out) {
  const f = CUBE_FACES[faceId];
  const uu = (u / (GRID - 1) - 0.5) * 0.92;
  const vv = (v / (GRID - 1) - 0.5) * 0.92;
  out.copy(f.n).multiplyScalar(0.5 + lift);
  out.addScaledVector(f.r, uu);
  out.addScaledVector(f.u, vv);
  return out;
}

export const cubeTopology = {
  kind: 'cube',
  name: 'Cube',
  grid: GRID,
  mid: MID,
  faceIds: CUBE_FACE_IDS,
  faces: CUBE_FACES,
  edges: CUBE_EDGES,
  faceAdj: CUBE_FACE_ADJ,
  faceNextHop: CUBE_FACE_NEXT_HOP,
  canonQuat: CUBE_CANON_QUAT,
  faceGridToLocal: cubeFaceGridToLocal,
  crossEdge: cubeCrossEdge,
  getEdgePortalEdge: cubeGetEdgePortalEdge,
  detectExit: cubeDetectExit,
  isCellUsable: cubeIsCellUsable,
  portalMids: Object.fromEntries(CUBE_EDGES.map(edge => [edge, edgeInfo('PY', edge).mid])),
  faceShape: 'square',
  startFace: 'PY',
  ghostFaces: ['PX', 'NX', 'PZ', 'NZ'],
  miniLocal: cubeMiniLocal
};

// Two levels: L1 (classic, ghosts) and L2 (ghost-free skill sampler: windmills,
// rolling ball, hammers, ice, conveyors). Clearing L2 completes the game.
export function specForLevel(level) {
  const mechanicSet = level <= 1 ? 'level1' : 'level2';
  return {
    id: 'cube-' + mechanicSet,
    topology: cubeTopology,
    startFace: cubeTopology.startFace,
    ghostFaces: cubeTopology.ghostFaces,
    mechanicSet,
    ghostsEnabled: mechanicSet === 'level1'
  };
}

export const FINAL_LEVEL = 2;
