// Per-face maze generation with guaranteed portal connectivity. Level 1 uses a
// dense cube maze; Level 2 uses a readable ring+cross arena (also on the cube).
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

// Level 2 face: a readable main-route arena on a square face. Every face keeps a
// central cross (reaching all four edge portals — the corridors hazards live on)
// plus an outer ring, but the four quadrants between them are decorated with a
// per-face variant so the layouts don't all look like an identical cross.
function generateRouteFace(seed, variant = 0) {
  const grid = Array.from({ length: GRID }, () => new Array(GRID).fill(WALL));

  // Outer ring corridor.
  for (let i = 1; i <= GRID - 2; i++) {
    grid[1][i] = PATH;
    grid[GRID - 2][i] = PATH;
    grid[i][1] = PATH;
    grid[i][GRID - 2] = PATH;
  }
  // Central cross, reaching the four edge-midpoint portals.
  for (let i = 0; i < GRID; i++) {
    grid[MID][i] = PATH;
    grid[i][MID] = PATH;
  }

  // Decorate the four quadrant blocks (3x3 interiors) for visual variety.
  const styles = ['solid', 'rooms', 'pillar', 'corners', 'rooms', 'pillar'];
  const style = styles[variant % styles.length];
  for (const [x0, y0] of [[2, 2], [GRID - 4, 2], [2, GRID - 4], [GRID - 4, GRID - 4]]) {
    decorateQuadrant(grid, x0, y0, style);
  }

  grid[MID][MID] = PATH;
  carvePortalClearance(grid);
  pruneUnreachable(grid, null, MID, MID);

  return buildPellets(grid, []); // no power pellets in the ghost-free dodge stage
}

function decorateQuadrant(grid, x0, y0, style) {
  if (style === 'solid') return; // leave as wall
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) grid[y0 + dy][x0 + dx] = PATH;
  }
  if (style === 'pillar') {
    grid[y0 + 1][x0 + 1] = WALL;
  } else if (style === 'corners') {
    grid[y0][x0] = WALL;
    grid[y0][x0 + 2] = WALL;
    grid[y0 + 2][x0] = WALL;
    grid[y0 + 2][x0 + 2] = WALL;
  }
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

function pruneUnreachable(grid, usable, sx, sy) {
  const seen = Array.from({ length: GRID }, () => new Array(GRID).fill(false));
  const stack = [[sx, sy]];
  seen[sy][sx] = true;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
      if (seen[ny][nx] || grid[ny][nx] !== PATH) continue;
      seen[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] === PATH && !seen[y][x]) grid[y][x] = WALL;
    }
  }
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

export function generateWorld(baseSeed = 1234, topology, mechanicSet = 'level1') {
  const faces = {};
  let total = 0;
  topology.faceIds.forEach((id, i) => {
    const f = mechanicSet === 'level1'
      ? generateFace(baseSeed + i * 97 + 7)
      : generateRouteFace(baseSeed + i * 97 + 7, i);
    faces[id] = f;
    total += f.dotCount;
  });
  return { faces, totalDots: total };
}

export function isPath(faceData, x, y) {
  return inBounds(x, y) && faceData.grid[y][x] === PATH;
}
