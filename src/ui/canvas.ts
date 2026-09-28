import { DIR_DELTA, type Dir, type GameState } from '../game/types';
import { idx } from '../game/engine';

const COLORS = {
  bg: '#070b16',
  rail: '#121a2e',
  grid: '#1a2744',
  wall: '#2a3348',
  wallGlow: '#3d4a66',
  arrow: '#2de2e6',
  arrowGlow: '#ff2a6d',
  hint: '#ffe66d',
  fail: '#ff2a6d',
  path: 'rgba(45, 226, 230, 0.25)',
};

const ARROW_GLYPH: Record<Dir, string> = {
  N: '▲',
  E: '▶',
  S: '▼',
  W: '◀',
};

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssSize: number,
  cols: number,
  rows: number,
): { cell: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const aspect = cols / rows;
  let cssW = cssSize;
  let cssH = cssSize / aspect;
  if (cssH > cssSize) {
    cssH = cssSize;
    cssW = cssSize * aspect;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cell: cssW / cols };
}

export interface DrawOpts {
  hint?: { x: number; y: number } | null;
  flashPath?: { x: number; y: number }[] | null;
  failFlash?: boolean;
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cell: number,
  opts: DrawOpts = {},
): void {
  const { w, h } = state;
  const pad = 2;
  ctx.clearRect(0, 0, cell * w, cell * h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cell * w, cell * h);

  // rails / grid
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x * cell;
      const py = y * cell;
      ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.rail : COLORS.grid;
      ctx.fillRect(px + pad, py + pad, cell - pad * 2, cell - pad * 2);
    }
  }

  // path flash
  if (opts.flashPath) {
    ctx.fillStyle = COLORS.path;
    for (const p of opts.flashPath) {
      ctx.fillRect(p.x * cell + pad, p.y * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = state.cells[idx(x, y, w)]!;
      const cx = x * cell + cell / 2;
      const cy = y * cell + cell / 2;
      if (c.kind === 'wall') {
        drawWall(ctx, x * cell, y * cell, cell, pad);
      } else if (c.kind === 'arrow') {
        const isHint = opts.hint && opts.hint.x === x && opts.hint.y === y;
        drawArrow(ctx, cx, cy, cell, c.dir, isHint ? COLORS.hint : COLORS.arrow, !!isHint);
      }
    }
  }

  if (opts.failFlash || state.status === 'failed') {
    ctx.fillStyle = 'rgba(255, 42, 109, 0.12)';
    ctx.fillRect(0, 0, cell * w, cell * h);
  }
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  pad: number,
): void {
  const r = Math.max(4, cell * 0.12);
  ctx.fillStyle = COLORS.wall;
  roundRect(ctx, px + pad, py + pad, cell - pad * 2, cell - pad * 2, r);
  ctx.fill();
  ctx.strokeStyle = COLORS.wallGlow;
  ctx.lineWidth = 2;
  ctx.stroke();
  // metro hatch
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(px + pad + 4, py + cell - pad - 4);
  ctx.lineTo(px + cell - pad - 4, py + pad + 4);
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  dir: Dir,
  color: string,
  glow: boolean,
): void {
  const size = cell * 0.38;
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
  } else {
    ctx.shadowColor = COLORS.arrowGlow;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  const { dx, dy } = DIR_DELTA[dir];
  // triangle pointing in dir
  const tipX = cx + dx * size;
  const tipY = cy + dy * size;
  const bx = -dy;
  const by = dx;
  const baseX = cx - dx * size * 0.55;
  const baseY = cy - dy * size * 0.55;
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + bx * size * 0.55, baseY + by * size * 0.55);
  ctx.lineTo(baseX - bx * size * 0.55, baseY - by * size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // subtle glyph for a11y
  ctx.fillStyle = 'rgba(7,11,22,0.55)';
  ctx.font = `bold ${Math.floor(cell * 0.22)}px system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ARROW_GLYPH[dir], cx - dx * size * 0.05, cy - dy * size * 0.05);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (w < 1 || h < 1) {
    ctx.beginPath();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Map pointer coords on canvas to cell. */
export function hitCell(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  state: GameState,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const lx = clientX - rect.left;
  const ly = clientY - rect.top;
  const x = Math.floor((lx / rect.width) * state.w);
  const y = Math.floor((ly / rect.height) * state.h);
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
  return { x, y };
}
