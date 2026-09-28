/**
 * Generate 50 solvable ArrowPath levels via reverse construction.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIRS = ['N', 'E', 'S', 'W'];
const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

function idx(x, y, w) {
  return y * w + x;
}
function inBounds(x, y, w, h) {
  return x >= 0 && y >= 0 && x < w && y < h;
}
function emptyBoard(w, h) {
  return Array.from({ length: w * h }, () => ({ kind: 'empty' }));
}
function pathClear(board, w, h, x, y, dir) {
  const [dx, dy] = DELTA[dir];
  let cx = x + dx;
  let cy = y + dy;
  while (true) {
    if (!inBounds(cx, cy, w, h)) return true;
    const c = board[idx(cx, cy, w)];
    if (c.kind === 'arrow' || c.kind === 'wall') return false;
    cx += dx;
    cy += dy;
  }
}
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateLevel(id, w, h, arrowCount, wallCount, seed) {
  const rng = mulberry32(seed);
  const board = emptyBoard(w, h);
  let wallsPlaced = 0;
  let guard = 0;
  while (wallsPlaced < wallCount && guard++ < 500) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    const i = idx(x, y, w);
    if (board[i].kind !== 'empty') continue;
    board[i] = { kind: 'wall' };
    wallsPlaced++;
  }
  const placed = [];
  guard = 0;
  while (placed.length < arrowCount && guard++ < 3000) {
    const empties = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (board[idx(x, y, w)].kind === 'empty') empties.push({ x, y });
      }
    }
    if (!empties.length) break;
    const cell = empties[Math.floor(rng() * empties.length)];
    const dirs = [...DIRS].sort(() => rng() - 0.5);
    for (const d of dirs) {
      if (pathClear(board, w, h, cell.x, cell.y, d)) {
        board[idx(cell.x, cell.y, w)] = { kind: 'arrow', dir: d };
        placed.push({ x: cell.x, y: cell.y, d });
        break;
      }
    }
  }
  if (placed.length < Math.max(2, Math.floor(arrowCount * 0.75))) return null;
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = board[idx(x, y, w)];
      if (c.kind === 'wall') cells.push({ x, y, t: 'wall' });
      else if (c.kind === 'arrow') cells.push({ x, y, t: 'arrow', d: c.dir });
    }
  }
  return { id, w, h, cells };
}

/** Handcrafted tutorials — each built so a known fire order works. */
const HAND = [
  // 1: single arrow east
  { id: 1, w: 3, h: 3, cells: [{ x: 1, y: 1, t: 'arrow', d: 'E' }] },
  // 2: clear right first, then left
  {
    id: 2,
    w: 3,
    h: 3,
    cells: [
      { x: 0, y: 1, t: 'arrow', d: 'E' },
      { x: 2, y: 1, t: 'arrow', d: 'E' },
    ],
  },
  // 3: three independent exits
  {
    id: 3,
    w: 4,
    h: 3,
    cells: [
      { x: 0, y: 0, t: 'arrow', d: 'W' },
      { x: 3, y: 1, t: 'arrow', d: 'E' },
      { x: 1, y: 2, t: 'arrow', d: 'S' },
    ],
  },
  // 4: fire bottom-right first (E), then bottom (S), then mid (E), then top (S)
  {
    id: 4,
    w: 4,
    h: 4,
    cells: [
      { x: 0, y: 0, t: 'arrow', d: 'S' },
      { x: 0, y: 2, t: 'arrow', d: 'E' },
      { x: 2, y: 2, t: 'arrow', d: 'S' },
      { x: 2, y: 3, t: 'arrow', d: 'E' },
    ],
  },
  // 5: chain — clear from the tip of the blocking chain
  {
    id: 5,
    w: 5,
    h: 3,
    cells: [
      { x: 0, y: 1, t: 'arrow', d: 'E' },
      { x: 2, y: 1, t: 'arrow', d: 'E' },
      { x: 4, y: 1, t: 'arrow', d: 'E' },
      { x: 4, y: 0, t: 'arrow', d: 'N' },
      { x: 0, y: 2, t: 'arrow', d: 'W' },
    ],
  },
  // 6: first wall intro — wall in center; arrows exit around it
  {
    id: 6,
    w: 5,
    h: 4,
    cells: [
      { x: 2, y: 1, t: 'wall' },
      { x: 0, y: 0, t: 'arrow', d: 'W' },
      { x: 4, y: 0, t: 'arrow', d: 'E' },
      { x: 4, y: 3, t: 'arrow', d: 'E' },
      { x: 0, y: 3, t: 'arrow', d: 'W' },
      { x: 1, y: 2, t: 'arrow', d: 'S' },
    ],
  },
  // 7
  {
    id: 7,
    w: 5,
    h: 5,
    cells: [
      { x: 2, y: 2, t: 'wall' },
      { x: 0, y: 0, t: 'arrow', d: 'N' },
      { x: 4, y: 0, t: 'arrow', d: 'E' },
      { x: 4, y: 4, t: 'arrow', d: 'S' },
      { x: 0, y: 4, t: 'arrow', d: 'W' },
      { x: 1, y: 1, t: 'arrow', d: 'W' },
      { x: 3, y: 3, t: 'arrow', d: 'E' },
    ],
  },
  // 8: two walls; clear east edge first
  {
    id: 8,
    w: 5,
    h: 5,
    cells: [
      { x: 1, y: 2, t: 'wall' },
      { x: 3, y: 2, t: 'wall' },
      { x: 0, y: 0, t: 'arrow', d: 'N' },
      { x: 4, y: 0, t: 'arrow', d: 'E' },
      { x: 4, y: 4, t: 'arrow', d: 'S' },
      { x: 0, y: 4, t: 'arrow', d: 'W' },
      { x: 2, y: 0, t: 'arrow', d: 'N' },
      { x: 2, y: 4, t: 'arrow', d: 'S' },
    ],
  },
  // 9
  {
    id: 9,
    w: 5,
    h: 5,
    cells: [
      { x: 2, y: 1, t: 'wall' },
      { x: 2, y: 3, t: 'wall' },
      { x: 0, y: 0, t: 'arrow', d: 'W' },
      { x: 4, y: 0, t: 'arrow', d: 'E' },
      { x: 4, y: 4, t: 'arrow', d: 'E' },
      { x: 0, y: 4, t: 'arrow', d: 'W' },
      { x: 0, y: 2, t: 'arrow', d: 'W' },
      { x: 4, y: 2, t: 'arrow', d: 'E' },
      { x: 1, y: 4, t: 'arrow', d: 'S' },
    ],
  },
  // 10: denser but reverse-built chain on bottom row
  {
    id: 10,
    w: 5,
    h: 5,
    cells: [
      { x: 2, y: 2, t: 'wall' },
      { x: 0, y: 0, t: 'arrow', d: 'N' },
      { x: 4, y: 0, t: 'arrow', d: 'E' },
      { x: 4, y: 4, t: 'arrow', d: 'S' },
      { x: 0, y: 4, t: 'arrow', d: 'W' },
      { x: 1, y: 0, t: 'arrow', d: 'E' },
      { x: 3, y: 4, t: 'arrow', d: 'W' },
      { x: 4, y: 2, t: 'arrow', d: 'E' },
      { x: 0, y: 2, t: 'arrow', d: 'W' },
    ],
  },
];

function profile(id) {
  if (id <= 20) return { w: 5, h: 5, arrows: 5 + (id % 3), walls: id >= 15 ? 1 : 0 };
  if (id <= 30) return { w: 6, h: 6, arrows: 7 + (id % 4), walls: 1 + (id % 2) };
  if (id <= 40) return { w: 6, h: 7, arrows: 9 + (id % 3), walls: 2 + (id % 2) };
  return { w: 7, h: 7, arrows: 11 + (id % 4), walls: 3 + (id % 3) };
}

const levels = [...HAND];
for (let id = 11; id <= 50; id++) {
  const p = profile(id);
  let level = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const seed = id * 10007 + attempt * 97 + 42;
    level = generateLevel(id, p.w, p.h, p.arrows, p.walls, seed);
    if (level) break;
  }
  if (!level) {
    // guaranteed solvable fallback: column of north arrows
    level = { id, w: p.w, h: p.h, cells: [] };
    for (let i = 0; i < Math.min(p.arrows, p.w); i++) {
      level.cells.push({ x: i, y: Math.floor(p.h / 2), t: 'arrow', d: 'N' });
    }
  }
  levels.push(level);
}

if (levels.length !== 50) {
  console.error('Expected 50, got', levels.length);
  process.exit(1);
}

const outDir = join(__dirname, '../public');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'levels.json'),
  JSON.stringify({ version: 1, theme: 'neon-metro', levels }, null, 2),
);
console.log('Wrote', levels.length, 'levels');
