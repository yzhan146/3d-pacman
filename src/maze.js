// Per-face maze generation with guaranteed portal connectivity. Level 1 uses the
// original cube layout; Level 2 reuses the same pellet/chase logic on triangular
// faces for the tetrahedron stage.
import { GRID, MID } from './config.js';

export const WALL = 0;
export const PATH = 1;
export const DOT = 1;
export const POWER = 2;

function inBounds(x, y) { return x >= 0 && x < GRID && y >= 0 && y < GRID; }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateFace(seed) {
  const rnd = mulberry32(seed);
  const grid = Array.from({ length: GRID }, () => new Array(GRID).fill(WALL));
  const visited = new Set();
  const key = (x, y) => x + ',' + y;
  const stack = [[0, 0]];
  visited.add(key(0, 0));
  grid[0][0] = PATH;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rnd);
    let advanced = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (inBounds(nx, ny) && !visited.has(key(nx, ny))) {
        grid[cy + dy / 2][cx + dx / 2] = PATH;
        grid[ny][nx] = PATH;
        visited.add(key(nx, ny));
        stack.push([nx, ny]);
        advanced = true;
        break;
      }
    }
    if (!advanced) stack.pop();
  }

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] !== WALL) continue;
      const horiz = inBounds(x - 1, y) && inBounds(x + 1, y) && grid[y][x - 1] === PATH && grid[y][x + 1] === PATH;
      const vert = inBounds(x, y - 1) && inBounds(x, y + 1) && grid[y - 1][x] === PATH && grid[y + 1][x] === PATH;
      if ((horiz || vert) && rnd() < 0.26) grid[y][x] = PATH;
    }
  }

  grid[MID][MID] = PATH;
  grid[MID][MID - 1] = PATH;
  carveInward(grid, 0, MID, 1, 0);
  carveInward(grid, GRID - 1, MID, -1, 0);
  carveInward(grid, MID, 0, 0, 1);
  carveInward(grid, MID, GRID - 1, 0, -1);
  carvePortalClearance(grid);
  return buildPellets(grid, pickPowerCells(grid));
}

function generateTriangleFace(seed, topology) {
  const rnd = mulberry32(seed);
  const base = generateFace(seed).grid;
  const grid = Array.from({ length: GRID }, () => new Array(GRID).fill(WALL));
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!topology.isCellUsable('TA', x, y)) continue;
      grid[y][x] = base[y][x];
    }
  }

  // Strong central backbone so every face remains readable despite the new shape.
  for (let y = 0; y <= MID; y++) grid[y][MID] = PATH;
  for (let x = 0; x < GRID; x++) grid[MID][x] = PATH;

  // Re-open any isolated pockets by carving toward the center line.
  for (let y = 0; y <= MID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!topology.isCellUsable('TA', x, y)) continue;
      if (grid[y][x] === PATH) continue;
      if ((x + y + Math.floor(rnd() * 3)) % 5 === 0) grid[y][x] = PATH;
    }
  }

  grid[0][MID] = PATH;
  grid[MID][0] = PATH;
  grid[MID][GRID - 1] = PATH;
  grid[MID][MID] = PATH;
  grid[MID - 1][MID] = PATH;

  return buildPellets(grid, trianglePowerCells(topology));
}

function buildPellets(grid, powerCells) {
  const pellets = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
  let dotCount = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] === PATH) {
        pellets[y][x] = DOT;
        dotCount++;
      }
    }
  }

  if (pellets[MID][MID] === DOT) { pellets[MID][MID] = 0; dotCount--; }
  for (const [px, py] of [[0, MID], [GRID - 1, MID], [MID, 0], [MID, GRID - 1]]) {
    if (!inBounds(px, py)) continue;
    if (pellets[py][px] !== 0) { pellets[py][px] = 0; dotCount--; }
  }

  for (const [px, py] of powerCells) {
    if (!inBounds(px, py) || grid[py][px] !== PATH) continue;
    if (pellets[py][px] === DOT) pellets[py][px] = POWER;
    else if (pellets[py][px] === 0) { pellets[py][px] = POWER; dotCount++; }
  }

  return { grid, pellets, dotCount };
}

function carveInward(grid, x, y, dx, dy) {
  grid[y][x] = PATH;
  let cx = x + dx, cy = y + dy;
  while (inBounds(cx, cy)) {
    if (grid[cy][cx] === PATH) break;
    grid[cy][cx] = PATH;
    cx += dx;
    cy += dy;
  }
}

function carvePortalClearance(grid) {
  const portals = [[0, MID], [GRID - 1, MID], [MID, 0], [MID, GRID - 1]];
  for (const [px, py] of portals) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (!inBounds(x, y)) continue;
        grid[y][x] = PATH;
      }
    }
  }
}

function pickPowerCells(grid) {
  const corners = [[2, 2], [GRID - 3, 2], [2, GRID - 3], [GRID - 3, GRID - 3]];
  return nearestPathCells(grid, corners);
}

function trianglePowerCells(topology) {
  const anchors = [[MID, 1], [2, MID - 1], [GRID - 3, MID - 1], [MID, MID - 2]];
  const grid = Array.from({ length: GRID }, () => new Array(GRID).fill(PATH));
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!topology.isCellUsable('TA', x, y)) grid[y][x] = WALL;
    }
  }
  return nearestPathCells(grid, anchors);
}

function nearestPathCells(grid, anchors) {
  const out = [];
  for (const [cx, cy] of anchors) {
    let best = null, bestD = Infinity;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      if (grid[y][x] !== PATH) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
    if (best) out.push(best);
  }
  return out;
}

export function generateWorld(baseSeed = 1234, topology) {
  const faces = {};
  let total = 0;
  topology.faceIds.forEach((id, i) => {
    const f = topology.kind === 'tetra'
      ? generateTriangleFace(baseSeed + i * 97 + 7, topology)
      : generateFace(baseSeed + i * 97 + 7);
    faces[id] = f;
    total += f.dotCount;
  });
  return { faces, totalDots: total };
}

export function isPath(faceData, x, y) {
  return inBounds(x, y) && faceData.grid[y][x] === PATH;
}
