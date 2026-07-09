// Central tuning constants for 3D Pac-Cube.

export const GRID = 11;                 // cells per face (odd -> true middle cell for portals)
export const MID = (GRID - 1) / 2;      // middle index = 7
export const CELL = 4;                  // world units per cell
export const FACE_SIZE = GRID * CELL;   // side length of a cube face
export const HALF = FACE_SIZE / 2;      // distance from cube center to a face plane

export const WALL_HEIGHT = 3.2;
export const PLAYER_RADIUS = 1.35;
export const PLAYER_SPEED = 17;         // world units / sec
export const GHOST_SPEED = 8.8;         // 20% slower for a more forgiving chase
export const GHOST_FRIGHT_SPEED = 5.2;  // 20% slower while frightened
export const FRIGHT_TIME = 7.5;         // seconds of frightened mode
export const LIVES_START = 3;

export const SCORE = {
  pellet: 10,
  power: 50,
  ghost: 200,        // doubles per chained ghost within one frightened window
  clearBonus: 1000
};

// Palette
export const COLORS = {
  pacman: 0xffd21a,
  wall: 0x2b3a8c,
  wallEmissive: 0x3350ff,
  floor: 0x0b0f22,
  floorAlt: 0x0e1430,
  pellet: 0xffe9a8,
  power: 0xfff0c0,
  ghosts: [0xff3b6b, 0xff9bd0, 0x53e0ff, 0xffab4d]
};

export const GHOST_NAMES = ['Blinky', 'Pinky', 'Inky', 'Clyde'];
export const FRIGHT_COLOR = 0x2b3bff;
export const FRIGHT_FLASH = 0xffffff;

export const CUBE_ROT_TIME = 0.55;      // seconds for a face-to-face world rotation

export const FACE_STYLES = [
  { name: 'Slate',  wallTint: 0x6f82b7, floorTint: 0x12182a, icon: 'sun',    iconColor: '#b8c7ef' },
  { name: 'Moss',   wallTint: 0x5d8d7d, floorTint: 0x101914, icon: 'leaf',   iconColor: '#b0d6c8' },
  { name: 'Plum',   wallTint: 0x8b6f96, floorTint: 0x17131c, icon: 'flower', iconColor: '#d4c0dd' },
  { name: 'Steel',  wallTint: 0x6f97a8, floorTint: 0x10181d, icon: 'moon',   iconColor: '#c1d8e1' },
  { name: 'Amber',  wallTint: 0xa28361, floorTint: 0x1a1510, icon: 'star',   iconColor: '#dbc7b0' },
  { name: 'Teal',   wallTint: 0x5e87a1, floorTint: 0x0e171c, icon: 'bird',   iconColor: '#b5d1df' }
];

// Per-level visual themes + difficulty ramp (cycles for endless levels).
export const THEMES = [
  { name: 'Deep Space',   nebula: ['#1a2a6c', '#05060c'], star: '#bcd0ff',
    fog: '#05060c', wall: 0x2b3a8c, wallEmissive: 0x3350ff, floor: 0x0b0f22, ghostSpeedMul: 1.0 },
  { name: 'Rose Nebula',  nebula: ['#7a1050', '#0a0410'], star: '#ffd6f0',
    fog: '#0a0410', wall: 0x8c2b6a, wallEmissive: 0xff4fb0, floor: 0x1a0a18, ghostSpeedMul: 1.12 },
  { name: 'Emerald Void', nebula: ['#0b5a4a', '#03100c'], star: '#c8ffe6',
    fog: '#03100c', wall: 0x1f7a5a, wallEmissive: 0x35ffb0, floor: 0x06170f, ghostSpeedMul: 1.24 },
  { name: 'Ember Storm',  nebula: ['#7a2a08', '#100603'], star: '#ffd7a8',
    fog: '#100603', wall: 0x9c4a1a, wallEmissive: 0xff7a2a, floor: 0x180a04, ghostSpeedMul: 1.38 }
];
export function themeForLevel(level) { return THEMES[(level - 1) % THEMES.length]; }
