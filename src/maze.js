// Per-face maze generation with loops, guaranteed connectivity, 4 edge-midpoint
// portals, pellets and 4 power-pellets. Pure data (no Three.js).
import { GRID, MID } from './config.js';

export const WALL = 0;
export const PATH = 1;

// Cell content flags for pellets, stored separately from the wall grid.
export const DOT = 1;
export const POWER = 2;

function inBounds(x, y) { return x >= 0 && x < GRID && y >= 0 && y < GRID; }

// Simple seeded RNG (mulberry32) so a level layout is reproducible per seed.
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

// Generate one face maze. Returns { grid, pellets, dotCount }.
export function generateFace(seed) {
  const rnd = mulberry32(seed);
  const grid = Array.from({ length: GRID }, () => new Array(GRID).fill(WALL));

  // Recursive backtracker on even-indexed nodes; carve connectors between them.
  const nodes = [];
  for (let y = 0; y < GRID; y += 2) for (let x = 0; x < GRID; x += 2) nodes.push([x, y]);
  const visited = new Set();
  const key = (x, y) => x + ',' + y;
  const start = [0, 0];
  const stack = [start];
  visited.add(key(...start));
  grid[0][0] = PATH;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rnd);
    let advanced = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (inBounds(nx, ny) && !visited.has(key(nx, ny))) {
        grid[cy + dy / 2][cx + dx / 2] = PATH; // connector wall between nodes
        grid[ny][nx] = PATH;
        visited.add(key(nx, ny));
        stack.push([nx, ny]);
        advanced = true;
        break;
      }
    }
    if (!advanced) stack.pop();
  }

  // Add loops: randomly open ~26% of connector walls between two path nodes.
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] !== WALL) continue;
      const horiz = inBounds(x - 1, y) && inBounds(x + 1, y) && grid[y][x - 1] === PATH && grid[y][x + 1] === PATH;
      const vert = inBounds(x, y - 1) && inBounds(x, y + 1) && grid[y - 1][x] === PATH && grid[y + 1][x] === PATH;
      if ((horiz || vert) && rnd() < 0.26) grid[y][x] = PATH;
    }
  }

  // Force the centre cell open AND connected (player / ghost spawn friendly).
  grid[MID][MID] = PATH;
  grid[MID][MID - 1] = PATH;      // link to guaranteed even/even maze node (MID-1,MID-1)

  // Carve the four edge-midpoint portals and a straight corridor inward until it
  // meets the existing maze, guaranteeing every portal is connected.
  carveInward(grid, 0, MID, 1, 0);          // LEFT  -> +x
  carveInward(grid, GRID - 1, MID, -1, 0);  // RIGHT -> -x
  carveInward(grid, MID, 0, 0, 1);          // BOTTOM-> +y
  carveInward(grid, MID, GRID - 1, 0, -1);  // TOP   -> -y

  // Pellets on every path cell; power pellets near the four corners.
  const pellets = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
  let dotCount = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] === PATH) { pellets[y][x] = DOT; dotCount++; }
    }
  }
  // Do not put a pellet on the centre spawn cell.
  if (pellets[MID][MID] === DOT) { pellets[MID][MID] = 0; dotCount--; }

  for (const [px, py] of pickPowerCells(grid, rnd)) {
    if (pellets[py][px] === DOT) { pellets[py][px] = POWER; /* count stays: still a pellet to clear */ }
    else if (pellets[py][px] === 0 && grid[py][px] === PATH) { pellets[py][px] = POWER; dotCount++; }
  }

  return { grid, pellets, dotCount };
}

function carveInward(grid, x, y, dx, dy) {
  grid[y][x] = PATH;
  let cx = x + dx, cy = y + dy;
  // walk inward until we hit an existing path cell (then we're connected)
  while (inBounds(cx, cy)) {
    if (grid[cy][cx] === PATH) break;
    grid[cy][cx] = PATH;
    cx += dx; cy += dy;
  }
}

function pickPowerCells(grid, rnd) {
  const corners = [[2, 2], [GRID - 3, 2], [2, GRID - 3], [GRID - 3, GRID - 3]];
  const out = [];
  for (const [cx, cy] of corners) {
    // find nearest path cell to this corner anchor
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

// Build all six faces. Returns a map faceId -> face data plus total dot count.
import { FACE_IDS } from './cube.js';
export function generateWorld(baseSeed = 1234) {
  const faces = {};
  let total = 0;
  FACE_IDS.forEach((id, i) => {
    const f = generateFace(baseSeed + i * 97 + 7);
    faces[id] = f;
    total += f.dotCount;
  });
  return { faces, totalDots: total };
}

export function isPath(faceData, x, y) {
  return inBounds(x, y) && faceData.grid[y][x] === PATH;
}
