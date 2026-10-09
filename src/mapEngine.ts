import * as THREE from 'three';
import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import {
  beachCoast, buildings, eyerShoals, FORT, fortCoast, mainCoast, piers, portAprons, portChannelCenterline, portChannelWidth, portCoast, SPACE_CENTER,
  REFERENCE, roads, type Building, type District, type LayerId, type Point, type SceneSettings,
} from './mapData';
import { createRoadNetwork, roadFootprint, type BridgeProfile, type RoadLine } from './roadSurfaces';

const OX = REFERENCE.originX;
const OY = REFERENCE.originY;
/** Quay level of the engineered port deck (metres at the default elevation of 10). */
const PORT_TOP = 4.4;
/** Foot of the port retaining walls, founded on the dredged harbour bed. */
const WALL_FOOT = -8.2;

const sm = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Ease-out ramp: a clear gradient at 0 and a flat finish at 1, so land meets water at a clean angle. */
const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * (2 - t));
const softPlus = (v: number) => 0.5 * (v + Math.sqrt(v * v + 0.09));
const hash = (n: number) => {
  const s = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
  return s - Math.floor(s);
};

export const worldPoint = (x: number, y: number, height = 0) => new THREE.Vector3(x - OX, height, y - OY);

interface SvgCmd {
  type: 'M' | 'L' | 'Q';
  x: number;
  y: number;
  cx?: number;
  cy?: number;
}

function parseSvgPath(d: string): SvgCmd[] {
  const regex = /([MLQZ])([^MLQZ]*)/gi;
  const cmds: SvgCmd[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(d)) !== null) {
    const type = match[1].toUpperCase() as 'M' | 'L' | 'Q' | 'Z';
    if (type === 'Z') continue;
    const nums = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (type === 'M' || type === 'L') {
      for (let i = 0; i < nums.length; i += 2) {
        if (!isNaN(nums[i]) && !isNaN(nums[i + 1])) {
          cmds.push({ type: cmds.length === 0 ? 'M' : type, x: nums[i], y: nums[i + 1] });
        }
      }
    } else if (type === 'Q') {
      for (let i = 0; i < nums.length; i += 4) {
        if (!isNaN(nums[i]) && !isNaN(nums[i + 1]) && !isNaN(nums[i + 2]) && !isNaN(nums[i + 3])) {
          cmds.push({ type: 'Q', cx: nums[i], cy: nums[i + 1], x: nums[i + 2], y: nums[i + 3] });
        }
      }
    }
  }
  return cmds;
}

/**
 * Fillet all corners in an SVG path with smooth, tangent-continuous quadratic
 * arcs. Replaces sharp polygonal turns with natural turning curves (radius ~18m).
 */
export function smoothSvgPath(d: string, defaultRadius = 18): string {
  const cmds = parseSvgPath(d);
  if (cmds.length < 3) return d;

  const isClosed = Math.hypot(cmds[0].x - cmds[cmds.length - 1].x, cmds[0].y - cmds[cmds.length - 1].y) < 3.0;
  const outCmds: SvgCmd[] = [];
  outCmds.push({ type: 'M', x: cmds[0].x, y: cmds[0].y });

  let curX = cmds[0].x, curY = cmds[0].y;

  for (let i = 1; i < cmds.length; i++) {
    const prev = { x: curX, y: curY };
    const curr = cmds[i];
    const next = i < cmds.length - 1 ? cmds[i + 1] : (isClosed ? cmds[1] : null);

    if (curr.type === 'L' && next) {
      const nextTarget = next.type === 'Q' ? { x: next.cx!, y: next.cy! } : { x: next.x, y: next.y };
      const dx0 = curr.x - prev.x, dy0 = curr.y - prev.y;
      const dx1 = nextTarget.x - curr.x, dy1 = nextTarget.y - curr.y;
      const len0 = Math.hypot(dx0, dy0);
      const len1 = Math.hypot(dx1, dy1);

      if (len0 > 1.5 && len1 > 1.5) {
        const dir0 = [dx0 / len0, dy0 / len0];
        const dir1 = [dx1 / len1, dy1 / len1];
        const dot = Math.max(-1, Math.min(1, dir0[0] * dir1[0] + dir0[1] * dir1[1]));
        const cross = dir0[0] * dir1[1] - dir0[1] * dir1[0];

        // Turn angle greater than ~2.5 degrees gets smoothly rounded
        if (dot < 0.999 && Math.abs(cross) > 0.04) {
          const turnAngle = Math.acos(dot);
          const idealT = defaultRadius * Math.tan(turnAngle / 2);
          const maxT = Math.min(len0, len1) * 0.44;
          const t = Math.min(idealT, maxT);

          if (t > 0.5) {
            const pStart = [curr.x - dir0[0] * t, curr.y - dir0[1] * t];
            const pEnd = [curr.x + dir1[0] * t, curr.y + dir1[1] * t];

            outCmds.push({ type: 'L', x: pStart[0], y: pStart[1] });
            outCmds.push({ type: 'Q', cx: curr.x, cy: curr.y, x: pEnd[0], y: pEnd[1] });

            curX = pEnd[0];
            curY = pEnd[1];
            continue;
          }
        }
      }
    }

    if (curr.type === 'L') {
      outCmds.push({ type: 'L', x: curr.x, y: curr.y });
      curX = curr.x;
      curY = curr.y;
    } else if (curr.type === 'Q') {
      outCmds.push({ type: 'Q', cx: curr.cx, cy: curr.cy, x: curr.x, y: curr.y });
      curX = curr.x;
      curY = curr.y;
    }
  }

  return outCmds.map(c => {
    if (c.type === 'M') return `M${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
    if (c.type === 'L') return `L${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
    if (c.type === 'Q') return `Q${c.cx!.toFixed(2)} ${c.cy!.toFixed(2)} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
    return '';
  }).join(' ');
}

export function samplePath(path: string, spacing = 1.0): Point[] {
  const smoothed = smoothSvgPath(path, 18);
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  element.setAttribute('d', smoothed);
  const length = element.getTotalLength();
  const count = Math.max(2, Math.ceil(length / spacing));
  return Array.from({ length: count + 1 }, (_, i) => {
    const p = element.getPointAtLength((i / count) * length);
    return [p.x, p.y] as Point;
  });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */
/* ------------------------------------------------------------------ */

function pointInPoly(x: number, z: number, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** Nearest point on a closed polygon outline. */
function closestOnPoly(x: number, z: number, poly: Point[]): Point {
  let best: Point = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    const px = a[0] + t * dx, pz = a[1] + t * dz;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}

/** Distance to an open polyline. */
function distToLine(x: number, z: number, line: Point[]) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)));
  }
  return best;
}

function channelPolygon(points: Point[], width: number): Point[] {
  const path = [...points];
  const first = points[0], last = points[points.length - 1];
  const head = points[1], tail = points[points.length - 2];
  const hLen = Math.hypot(head[0] - first[0], head[1] - first[1]) || 1;
  const tLen = Math.hypot(last[0] - tail[0], last[1] - tail[1]) || 1;
  path[0] = [first[0] - (head[0] - first[0]) / hLen * 8, first[1] - (head[1] - first[1]) / hLen * 8];
  path[path.length - 1] = [last[0] + (last[0] - tail[0]) / tLen * 8, last[1] + (last[1] - tail[1]) / tLen * 8];
  const left = path.map(([x, z], i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
    return [x - dz / d * width / 2, z + dx / d * width / 2] as Point;
  });
  const right = path.map(([x, z], i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
    return [x + dz / d * width / 2, z - dx / d * width / 2] as Point;
  }).reverse();
  return [...left, ...right];
}

const PORT_CHANNEL = channelPolygon(portChannelCenterline, portChannelWidth);

/** Corner-cutting subdivision: turns the traced coastline polygon into a flowing curve. */
function chaikin(poly: Point[], iterations: number): Point[] {
  let pts = poly;
  for (let it = 0; it < iterations; it++) {
    const next: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return pts;
}

/** Short fillets on engineered outlines: crisp quay runs without razor-sharp corners. */
export function roundCorners(poly: Point[], radius: number, steps = 3): Point[] {
  const out: Point[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const ax = p0[0] - p1[0], az = p0[1] - p1[1];
    const bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) { out.push(p1); continue; }
    const angle = Math.acos(clamp((ax * bx + az * bz) / (la * lb), -1, 1));
    if (angle > Math.PI * 0.97) { out.push(p1); continue; }
    const t = Math.min(radius / Math.tan(angle / 2), la * 0.45, lb * 0.45);
    const s0: Point = [p1[0] + (ax / la) * t, p1[1] + (az / la) * t];
    const s1: Point = [p1[0] + (bx / lb) * t, p1[1] + (bz / lb) * t];
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
      out.push([w0 * s0[0] + w1 * p1[0] + w2 * s1[0], w0 * s0[1] + w1 * p1[1] + w2 * s1[1]]);
    }
  }
  return out;
}

function extendLine(line: Point[], amount: number): Point[] {
  const out = line.map(p => [p[0], p[1]] as Point);
  const a = line[0], b = line[1];
  const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  out[0] = [a[0] + ((a[0] - b[0]) / la) * amount, a[1] + ((a[1] - b[1]) / la) * amount];
  const c = line[line.length - 2], d = line[line.length - 1];
  const ld = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1;
  out[out.length - 1] = [d[0] + ((d[0] - c[0]) / ld) * amount, d[1] + ((d[1] - c[1]) / ld) * amount];
  return out;
}

/* ------------------------------------------------------------------ */
/* Terrain field                                                        */
/* One smooth height raster drives the land, the seabed, the shoreline  */
/* and every object placed on the ground.                               */
/* ------------------------------------------------------------------ */

const CELL = 2;                  // analysis raster spacing (m)
const MESH = 4;                  // render mesh spacing (m): every second raster node
const STEP = MESH / CELL;
// Extended west/north so Fort Island (A1/A2, image x 230 / z -24) and south as
// far as the A9/A10 Eyer Shoals (image z 1200) keep a full seabed shelf.
const DX0 = 160, DZ0 = -100;     // domain origin in image coordinates
const DW = 1080, DH = 1360;      // domain size (m); both divisible by MESH
const NX = DW / CELL + 1, NZ = DH / CELL + 1;
const MX = DW / MESH + 1, MZ = DH / MESH + 1;
const CULL_DEPTH = -6.4;         // seabed deeper than this is never visible
const DEEP_WATER = 7.2;          // depth where the shallows reach the open-sea colour
const LIGHTHOUSE: Point = [753, 103];
/** Outer edge of the working harbour: pier heads and container quays. */
const HARBOR_FRONT: Point[] = [[946, 772], [936, 806], [898, 828], [836, 862], [806, 878], [762, 897], [756, 930], [735, 934]];

/** Main island outline without the detached port lobe. */
const MAIN_ONLY: Point[] = (() => {
  const a = mainCoast.findIndex(p => p[0] === 845 && p[1] === 626);
  const b = mainCoast.findIndex(p => p[0] === 831 && p[1] === 643);
  return a >= 0 && b > a ? [...mainCoast.slice(0, a + 1), ...mainCoast.slice(b)] : mainCoast;
})();

function buildPortSlab(): Point[] {
  const gap = portChannelWidth / 2 + 1.2;
  const pushed = portCoast.map(([x, z]) => {
    const d = distToLine(x, z, portChannelCenterline);
    if (d >= gap) return [x, z] as Point;
    const near = closestOnPoly(x, z, PORT_CHANNEL);
    let nx = x - near[0], nz = z - near[1];
    if (Math.hypot(nx, nz) < 1e-6) {
      const probe = closestOnPoly(x, z, portCoast);
      nx = x - probe[0]; nz = z - probe[1];
    }
    const l = Math.hypot(nx, nz) || 1;
    let p: Point = [x + (nx / l) * (gap - d), z + (nz / l) * (gap - d)];
    if (!pointInPoly(p[0], p[1], portCoast)) p = [x - (nx / l) * (gap - d), z - (nz / l) * (gap - d)];
    return p;
  });
  return roundCorners(pushed, 3.5, 3);
}

/* -- raster utilities ------------------------------------------------ */

function rasterizePolygon(poly: Point[], mask: Uint8Array) {
  const xs: number[] = [];
  const n = poly.length;
  for (let j = 0; j < NZ; j++) {
    const z = DZ0 + j * CELL;
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - DX0) / CELL));
      const i1 = Math.min(NX - 1, Math.floor((xs[k + 1] - DX0) / CELL));
      for (let i = i0; i <= i1; i++) mask[j * NX + i] = 1;
    }
  }
}

const BIG = 1e20;

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, zb: Float64Array) {
  let k = 0;
  v[0] = 0;
  zb[0] = -Infinity;
  zb[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= zb[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    zb[k] = s;
    zb[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zb[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Exact distance (m) from every node to the nearest node whose mask equals `feature`. */
function distanceField(mask: Uint8Array, feature: number): Float32Array {
  const N = NX * NZ;
  const g = new Float64Array(N);
  for (let k = 0; k < N; k++) g[k] = mask[k] === feature ? 0 : BIG;
  const n = Math.max(NX, NZ);
  const f = new Float64Array(n), d = new Float64Array(n), zb = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) f[j] = g[j * NX + i];
    edt1d(f, NZ, d, v, zb);
    for (let j = 0; j < NZ; j++) g[j * NX + i] = d[j];
  }
  const out = new Float32Array(N);
  for (let j = 0; j < NZ; j++) {
    const row = j * NX;
    for (let i = 0; i < NX; i++) f[i] = g[row + i];
    edt1d(f, NX, d, v, zb);
    for (let i = 0; i < NX; i++) out[row + i] = Math.sqrt(Math.min(d[i], 1e12)) * CELL;
  }
  return out;
}

function boxPass(src: Float32Array, dst: Float32Array, horizontal: boolean, r: number, pre: Float64Array) {
  const n = horizontal ? NX : NZ;
  const lines = horizontal ? NZ : NX;
  const step = horizontal ? 1 : NX;
  const lineStep = horizontal ? NX : 1;
  const inv = 1 / (2 * r + 1);
  const ext = n + 2 * r;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    pre[0] = 0;
    for (let k = 0; k < ext; k++) {
      let idx = k - r;
      if (idx < 0) idx = 0; else if (idx >= n) idx = n - 1;
      pre[k + 1] = pre[k] + src[base + idx * step];
    }
    for (let i = 0; i < n; i++) dst[base + i * step] = (pre[i + 2 * r + 1] - pre[i]) * inv;
  }
}

/** Fast Gaussian blur (three box passes per axis). Sigma is in raster cells. */
function gaussBlur(src: Float32Array, sigma: number): Float32Array {
  const passes = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - passes * wl * wl - 4 * passes * wl - 3 * passes) / (-4 * wl - 4));
  const radii: number[] = [];
  for (let i = 0; i < passes; i++) radii.push(Math.max(0, ((i < m ? wl : wu) - 1) / 2));
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const pre = new Float64Array(Math.max(NX, NZ) + 2 * Math.max(...radii) + 2);
  for (const horizontal of [true, false]) {
    for (const r of radii) {
      if (r <= 0) continue;
      boxPass(a, b, horizontal, r, pre);
      const t = a; a = b; b = t;
    }
  }
  return a;
}

function sampleRaster(arr: Float32Array, x: number, z: number) {
  const fx = clamp((x - DX0) / CELL, 0, NX - 1.0001);
  const fz = clamp((z - DZ0) / CELL, 0, NZ - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const k = j * NX + i;
  return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + NX] * (1 - u) + arr[k + NX + 1] * u) * v;
}

function gridRange(x0: number, x1: number, z0: number, z1: number): [number, number, number, number] {
  return [
    Math.max(0, Math.floor((x0 - DX0) / CELL)), Math.min(NX - 1, Math.ceil((x1 - DX0) / CELL)),
    Math.max(0, Math.floor((z0 - DZ0) / CELL)), Math.min(NZ - 1, Math.ceil((z1 - DZ0) / CELL)),
  ];
}

function fillLineDistance(line: Point[], out: Float32Array, margin: number) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  line.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  const [i0, i1, j0, j1] = gridRange(x0 - margin, x1 + margin, z0 - margin, z1 + margin);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      out[k] = Math.min(out[k], distToLine(DX0 + i * CELL, DZ0 + j * CELL, line));
    }
  }
}

function stampMinDistance(cx: number, cz: number, radius: number, out: Float32Array) {
  const [i0, i1, j0, j1] = gridRange(cx - radius, cx + radius, cz - radius, cz + radius);
  for (let j = j0; j <= j1; j++) {
    const dz = DZ0 + j * CELL - cz;
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(DX0 + i * CELL - cx, dz);
      const k = j * NX + i;
      if (d < out[k]) out[k] = d;
    }
  }
}

/** Accumulates a feathered level platform (flat core, smooth falloff) towards a target height. */
function stampDisk(cx: number, cz: number, core: number, feather: number, target: number, accW: Float32Array, accH: Float32Array, maxW: Float32Array) {
  const R = core + feather;
  const [i0, i1, j0, j1] = gridRange(cx - R, cx + R, cz - R, cz + R);
  for (let j = j0; j <= j1; j++) {
    const dz = DZ0 + j * CELL - cz;
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(DX0 + i * CELL - cx, dz);
      if (d >= R) continue;
      const w = d <= core ? 1 : 1 - sm((d - core) / feather);
      const k = j * NX + i;
      accW[k] += w;
      accH[k] += w * target;
      if (w > maxW[k]) maxW[k] = w;
    }
  }
}

/** Same as stampDisk for a rotated rectangular building footprint. */
function stampRect(cx: number, cz: number, hw: number, hd: number, cos: number, sin: number, feather: number, target: number, accW: Float32Array, accH: Float32Array, maxW: Float32Array) {
  const R = Math.hypot(hw, hd) + feather;
  const [i0, i1, j0, j1] = gridRange(cx - R, cx + R, cz - R, cz + R);
  for (let j = j0; j <= j1; j++) {
    const dz = DZ0 + j * CELL - cz;
    for (let i = i0; i <= i1; i++) {
      const dx = DX0 + i * CELL - cx;
      const lx = dx * cos + dz * sin, lz = -dx * sin + dz * cos;
      const d = Math.hypot(Math.max(Math.abs(lx) - hw, 0), Math.max(Math.abs(lz) - hd, 0));
      if (d >= feather) continue;
      const w = d <= 0 ? 1 : 1 - sm(d / feather);
      const k = j * NX + i;
      accW[k] += w;
      accH[k] += w * target;
      if (w > maxW[k]) maxW[k] = w;
    }
  }
}

function smoothSeries(values: number[], sigma: number): number[] {
  const r = Math.ceil(sigma * 2.5);
  return values.map((_, i) => {
    let acc = 0, wsum = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      acc += values[j] * w;
      wsum += w;
    }
    return acc / wsum;
  });
}

/* -- landform profiles (metres at elevation 10; s = metres inland) ---- */

/** Seabed: wide shelves off beaches, firmer drops at embankments and rock, dredged harbour basins. */
function seaFloor(s: number, wb: number, we: number, wr: number, dredge: number) {
  const u = -s;
  const db = 1.7 * easeOut(u / 26) + 4.2 * sm((u - 16) / 48);
  const de = 2.3 * easeOut(u / 6) + 4.0 * sm((u - 4) / 30);
  const dr = 3.2 * easeOut(u / 7) + 4.4 * sm((u - 5) / 24);
  let d = wb * db + we * de + wr * dr;
  d = mix(d, 7.8, dredge * sm(u / 9));
  d = mix(d, 7.4, sm((u - 52) / 20));
  return -d;
}

/** Broad, intentional relief: low town plateau, a proper North Town highland, lighthouse summit highest. */
function interiorMain(x: number, z: number) {
  // North highland massif: rises well clear of downtown, full height across North Town.
  const northMask = sm((385 - z) / 210);
  const plateau = 11.5 * northMask;
  // Lighthouse summit cone on top of the plateau.
  const summitD2 = (x - LIGHTHOUSE[0]) ** 2 + (z - LIGHTHOUSE[1]) ** 2;
  // A tighter extra lift affects the lighthouse lookout alone, not all of North Town.
  const summit = 13.5 * Math.exp(-summitD2 / (2 * 42 * 42));
  // Rolling secondary shoulders so the highland reads as natural ground, not a dome.
  const westRidge = 2.4 * Math.exp(-(((x - 672) / 58) ** 2 + ((z - 190) / 85) ** 2));
  const eastShoulder = 1.9 * Math.exp(-(((x - 800) / 60) ** 2 + ((z - 250) / 75) ** 2));
  // Gentle saddle at the gateway so downtown hands over to the climb without a step.
  const gatewayDip = -1.0 * Math.exp(-(((x - 700) / 120) ** 2 + ((z - 360) / 35) ** 2));
  // Long-wavelength undulation across the highland only — rolling, never noisy.
  const rolling = northMask * (0.9 * Math.sin(x * 0.008 + 0.5) * Math.cos(z * 0.0065) + 0.6 * Math.sin(x * 0.013 + 2.0) * Math.sin(z * 0.011));
  const crown = 0.6 * Math.exp(-(((x - 640) / 170) ** 2 + ((z - 520) / 150) ** 2));
  return 3.6 + plateau + summit + westRidge + eastShoulder + gatewayDip + rolling + crown;
}

/** Fort Island: rocky promontory carrying the old fort, level launch terrace to the south. */
function interiorFort(x: number, z: number) {
  // The promontory is the island's highest ground — a natural lookout for the fort.
  const headland = 9.0 * Math.exp(-(((x - FORT[0]) / 38) ** 2 + ((z - FORT[1] + 8) / 48) ** 2));
  // Broad, level terrace in the southern lobe for the space centre.
  const terrace = 3.4 * sm((z - 80) / 85);
  // Shoulder joining headland to terrace so the climb reads as landform, not a step.
  const shoulder = 1.4 * Math.exp(-(((x - 300) / 50) ** 2 + ((z - 103) / 45) ** 2));
  const roll = 0.45 * Math.sin(x * 0.019 + 1.1) * Math.sin(z * 0.015 + 0.3);
  return 3.4 + headland + terrace + shoulder + roll;
}

/** Beach width on the main island: broader sands along the sheltered south-west. */
const mainBeachWidth = (x: number, z: number) => 22 + 12 * Math.exp(-(((x - 420) / 160) ** 2 + ((z - 640) / 150) ** 2));

/* -- Eyer Shoals: per-islet character so the cluster never reads as clones ---- */
const ISLET_CENTERS: Point[] = eyerShoals.map(poly => {
  let sx = 0, sz = 0;
  poly.forEach(([x, z]) => { sx += x; sz += z; });
  return [sx / poly.length, sz / poly.length];
});
const isletIndexAt = (x: number, z: number) => {
  let bi = 0, bd = Infinity;
  ISLET_CENTERS.forEach(([cx, cz], i) => {
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    if (d < bd) { bd = d; bi = i; }
  });
  return bi;
};
// cap: plateau height; shelf: how far the foreshore runs before the drop-off;
// rock: 0 = soft sand, 1 = bare skerry. Varied on purpose — bank, frill, skerry…
const ISLET_CHAR = [
  { cap: 3.6, shelf: 15, rock: 0.15 },
  { cap: 1.5, shelf: 9, rock: 0 },
  { cap: 4.4, shelf: 12, rock: 0.5 },
  { cap: 5.8, shelf: 7, rock: 0.95 },
  { cap: 2.6, shelf: 11, rock: 0.3 },
  { cap: 3.0, shelf: 6, rock: 1 },
  { cap: 2.2, shelf: 6, rock: 1 },
  { cap: 1.9, shelf: 6, rock: 1 },
];

/** Small-islet land: a low cap with a hint of dune/rock bump, tight foreshore. */
function isletLand(sv: number, x: number, z: number, c: { cap: number; shelf: number; rock: number }) {
  const bump = Math.sin(x * 0.075 + z * 0.05) * Math.cos(z * 0.062 - x * 0.031);
  const rise = c.cap * (1 + 0.16 * bump) * sm(sv / c.shelf);
  const crest = 0.5 * c.cap * 0.25 * Math.max(0, bump) * sm((sv - c.shelf * 0.55) / (c.shelf * 0.5));
  return rise + crest;
}

/** Small-islet seabed: a narrow reef shelf, then a prompt drop — no wide halo. */
function isletSea(sv: number, c: { shelf: number; rock: number }) {
  const u = -sv;
  const shelf = c.rock > 0.5
    ? 3.0 * easeOut(u / 4) + 3.6 * sm((u - 3) / 11)
    : 1.9 * easeOut(u / c.shelf) + 3.6 * sm((u - 5) / 16);
  return -shelf;
}

function mainLand(s: number, wb: number, we: number, wr: number, beachW: number, interior: number) {
  const shoulder = wb * 2.2 * easeOut(s / beachW) + we * 2.6 * easeOut(s / 7) + wr * 4.2 * easeOut(s / 10);
  const top = wb * 2.2 + we * 2.6 + wr * 4.2;
  const lift = softPlus(interior - top);
  // Gentler target grades so the taller north highland climbs naturally; rock stays steeper.
  const ramp = clamp(lift / mix(0.06, 0.32, wr), 18, 150);
  return shoulder + lift * sm(s / ramp);
}

/** Beach Island: gentle sand slopes, a soft dune ridge behind the wider eastern beach. */
function beachLand(s: number, x: number, z: number) {
  const spine = 997 + (z - 266) * 0.2251;
  const east = sm((x - spine + 6) / 34);
  const L = mix(20, 36, east);
  const shore = 2.2 * easeOut(s / L);
  const dune = 0.95 * east * Math.exp(-(((s - 0.95 * L) / 11) ** 2));
  const rise = 0.5 * sm((s - L) / 30);
  return shore + dune + rise;
}

/* -- terrain colour ---------------------------------------------------- */

const TC = {
  grassLow: new THREE.Color('#a9bd8b'),
  grassHigh: new THREE.Color('#8fab7e'),
  grassCoast: new THREE.Color('#bac995'),
  sand: new THREE.Color('#e4d4a3'),
  dune: new THREE.Color('#d5c38e'),
  wet: new THREE.Color('#c7b386'),
  stone: new THREE.Color('#a39c8b'),
  rock: new THREE.Color('#8a8679'),
  prep: new THREE.Color('#b7ba95'),
  seabed: new THREE.Color('#c2b48b'),
  seabedDeep: new THREE.Color('#7b8e84'),
  quay: new THREE.Color('#b9b3a4'),
};

function shadeTerrain(out: THREE.Color, x: number, z: number, h: number, s: number, wr: number, e: number, beach: boolean, deck: boolean, slope: number, prep: number, islet = false) {
  if (deck) { out.copy(TC.quay); return; }
  if (h < -0.03) {
    out.copy(TC.seabed).lerp(TC.seabedDeep, sm(-h / 4.5));
    return;
  }
  if (islet) {
    // Sand bars read pale; skerries bare stone; the frill islet gets a grassy tuft.
    out.copy(TC.sand);
    out.lerp(TC.rock, clamp(wr * (1 - sm((s - 2) / 5)) + wr * sm((slope - 0.3) / 0.3), 0, 1));
    out.lerp(TC.grassCoast, (1 - wr) * 0.4 * sm((s - 6) / 10));
  } else if (beach) {
    const spine = 997 + (z - 266) * 0.2251;
    const east = sm((x - spine + 6) / 34);
    const L = mix(20, 36, east);
    out.copy(TC.grassCoast);
    out.lerp(TC.dune, 0.8 * east * Math.exp(-(((s - 0.95 * L) / 9) ** 2)));
    out.lerp(TC.sand, 1 - sm((s - 0.78 * L) / (0.3 * L)));
  } else {
    const we = (1 - wr) * e, wb = (1 - wr) * (1 - e);
    const L = mainBeachWidth(x, z);
    out.copy(TC.grassLow).lerp(TC.grassHigh, sm((h - 6) / 11));
    out.lerp(TC.sand, wb * (1 - sm((s - 0.7 * L) / (0.35 * L))));
    out.lerp(TC.stone, we * (1 - sm((s - 4.5) / 4)));
    out.lerp(TC.rock, clamp(wr * (1 - sm((s - 8) / 6)) + wr * 0.85 * sm((slope - 0.2) / 0.25) + sm((slope - 0.62) / 0.3), 0, 1));
  }
  out.lerp(TC.wet, 0.7 * (1 - sm(h / 0.5)));
  out.lerp(TC.prep, 0.2 * prep);
  out.multiplyScalar(1 + 0.025 * Math.sin(x * 0.019 + 1.3) * Math.sin(z * 0.016 + 0.4));
}

/* -- field assembly ------------------------------------------------------ */

interface TerrainField {
  heights: Float32Array;   // MX*MZ node heights in metres at elevation 10
  colors: Float32Array;    // MX*MZ*3 linear vertex colours
  deck: Uint8Array;        // MX*MZ, 1 under the engineered port deck
  slab: Point[];
  aprons: Point[][];
  deckPolys: Point[][];
  deckBox: [number, number, number, number];
}

let FIELD: TerrainField | null = null;

function getTerrainField(): TerrainField {
  if (FIELD) return FIELD;
  const N = NX * NZ;
  const slab = buildPortSlab();
  const aprons = portAprons.map(a => roundCorners(a, 2.5, 3));
  // Several traced port streets intentionally hug the quay perimeter. Extend
  // the engineered deck under their full sidewalk corridor before clipping the
  // road network, otherwise only the inland half of those roads survives.
  const portRoadIds = new Set(['port-coast', 'harbor-approach', 'harbor-south']);
  const portRoadDecks: MultiPolygon[] = roads
    .filter(road => !road.bridge && portRoadIds.has(road.id))
    .flatMap(road => (road.path.match(/M[^M]*/g) || []).map(part => roadFootprint(samplePath(part, 1.0), road.width + 8)));
  const wholeDeck: MultiPolygon = polygonClipping.union([slab], ...aprons.map(apron => [apron]), ...portRoadDecks);
  const deckPolys: Point[][] = wholeDeck
    .map(poly => poly[0].slice(0, -1) as Point[])
    .filter(poly => poly.length >= 3);
  const channelLine = extendLine(portChannelCenterline, 8);

  /* 1. Land masks from softened coastlines. */
  const mainMask = new Uint8Array(N);
  const beachMask = new Uint8Array(N);
  const fortMask = new Uint8Array(N);
  const eyerMask = new Uint8Array(N);
  const deckMask = new Uint8Array(N);
  rasterizePolygon(chaikin(MAIN_ONLY, 2), mainMask);
  rasterizePolygon(chaikin(beachCoast, 2), beachMask);
  rasterizePolygon(chaikin(fortCoast, 2), fortMask);
  eyerShoals.forEach(islet => rasterizePolygon(chaikin(islet, 2), eyerMask));
  deckPolys.forEach(poly => rasterizePolygon(poly, deckMask));

  const chanDist = new Float32Array(N).fill(999);
  const harborDist = new Float32Array(N).fill(999);
  fillLineDistance(channelLine, chanDist, 70);
  fillLineDistance(HARBOR_FRONT, harborDist, 90);

  const land = new Uint8Array(N);
  const other = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const main = mainMask[k] === 1 && chanDist[k] > portChannelWidth / 2 + 0.5;
    other[k] = main || deckMask[k] === 1 ? 1 : 0;
    land[k] = other[k] === 1 || beachMask[k] === 1 || fortMask[k] === 1 || eyerMask[k] === 1 ? 1 : 0;
  }

  /* 2. Signed coastal distance, blurred so corners soften and medial creases disappear. */
  const toBeach = distanceField(beachMask, 1);
  const toFort = distanceField(fortMask, 1);
  const toEyer = distanceField(eyerMask, 1);
  const toOther = distanceField(other, 1);
  const toWater = distanceField(land, 0);
  const deckDist = distanceField(deckMask, 1);
  const rawS = new Float32Array(N);
  const beachZone = new Uint8Array(N);
  const fortZone = new Uint8Array(N);
  const eyerZone = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const toNearest = Math.min(toBeach[k], toOther[k], toFort[k], toEyer[k]);
    fortZone[k] = toFort[k] <= toNearest ? 1 : 0;
    eyerZone[k] = !fortZone[k] && toEyer[k] <= toNearest ? 1 : 0;
    beachZone[k] = fortZone[k] || eyerZone[k] ? 0 : toBeach[k] < toOther[k] ? 1 : 0;
    rawS[k] = land[k] ? Math.min(toWater[k] - CELL / 2, 160) : -Math.min(toNearest - CELL / 2, 160);
  }
  const s = gaussBlur(rawS, 2.5);

  /* 3. Road proximity decides where the coast is a built embankment. */
  const roadLines = roads.filter(r => !r.bridge).flatMap(r =>
    (r.path.match(/M[^M]*/g) || []).map(part => ({ pts: samplePath(part, 2), width: r.width })));
  const roadDist = new Float32Array(N).fill(99);
  roadLines.forEach(line => {
    for (let i = 0; i < line.pts.length; i += 2) stampMinDistance(line.pts[i][0], line.pts[i][1], 22, roadDist);
  });

  /* 4. Shore character: rocky headland, built embankment or natural beach. */
  const rock = new Float32Array(N);
  const embPlain = new Float32Array(N);
  const embBand = new Float32Array(N);
  const band = new Float32Array(N);
  const dredge = new Float32Array(N);
  for (let j = 0; j < NZ; j++) {
    const z = DZ0 + j * CELL;
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      const x = DX0 + i * CELL;
      if (!beachZone[k]) {
        // Rocky cliffs hug the lighthouse headland; North Town stays grassy and buildable.
        rock[k] = Math.max(
          1 - sm((Math.hypot(x - LIGHTHOUSE[0], z - LIGHTHOUSE[1]) - 70) / 80),
          // The old-fort promontory is cliff-backed rock, like the lighthouse headland.
          fortZone[k] ? 1 - sm((Math.hypot(x - FORT[0], z - FORT[1]) - 44) / 58) : 0,
        );
        embPlain[k] = Math.max(1 - sm((roadDist[k] - 10) / 10), 1 - sm((chanDist[k] - 18) / 25), 1 - sm((deckDist[k] - 6) / 20));
      }
      // Skerries and the rocky frill islet carry bare stone; sand bars stay soft.
      if (eyerZone[k]) rock[k] = ISLET_CHAR[isletIndexAt(x, z)].rock;
      band[k] = Math.exp(-((s[k] / 14) ** 2));
      embBand[k] = embPlain[k] * band[k];
      dredge[k] = Math.max(1 - sm((harborDist[k] - 28) / 32), 1 - sm((chanDist[k] - 10) / 16));
    }
  }
  // Normalised convolution: the shore type varies smoothly along the coast, not across it.
  // A wide second pass carries the local value offshore and inland without any seam.
  const num1 = gaussBlur(embBand, 7), den1 = gaussBlur(band, 7);
  const num2 = gaussBlur(embBand, 20), den2 = gaussBlur(band, 20);
  const emb = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const wide = den2[k] > 1e-9 ? num2[k] / den2[k] : 0;
    const local = den1[k] > 1e-9 ? num1[k] / den1[k] : wide;
    emb[k] = clamp(mix(wide, local, sm(den1[k] / 0.02)), 0, 1);
  }

  /* 5. Base landform: coastal shoulders + broad interior relief, seabed shelves offshore. */
  const h0 = new Float32Array(N);
  for (let j = 0; j < NZ; j++) {
    const z = DZ0 + j * CELL;
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      const x = DX0 + i * CELL;
      const sv = s[k];
      const wr = rock[k], e = emb[k];
      const we = (1 - wr) * e, wb = (1 - wr) * (1 - e);
      if (eyerZone[k]) {
        const c = ISLET_CHAR[isletIndexAt(x, z)];
        h0[k] = sv < 0 ? isletSea(sv, c) : isletLand(sv, x, z, c);
      } else if (sv < 0) h0[k] = seaFloor(sv, wb, we, wr, dredge[k]);
      else if (beachZone[k]) h0[k] = beachLand(sv, x, z);
      else if (fortZone[k]) h0[k] = mainLand(sv, wb, we, wr, 20, interiorFort(x, z));
      else h0[k] = mainLand(sv, wb, we, wr, mainBeachWidth(x, z), interiorMain(x, z));
    }
  }
  // Grading only lifts the shallow margin, so built edges never swallow the coastline.
  const shallowGate = (h: number) => (h >= 0 ? 1 : sm(1 + h / 1.6));

  /* 6. Road corridors: level platforms following a smoothed longitudinal profile. */
  const roadAccW = new Float32Array(N), roadAccH = new Float32Array(N), roadW = new Float32Array(N);
  roadLines.forEach(line => {
    // Longer smoothing + wider feather so hill roads climb evenly without steps.
    const profile = smoothSeries(line.pts.map(([x, z]) => sampleRaster(h0, x, z)), 8);
    const core = line.width / 2 + 4;
    line.pts.forEach(([x, z], i) => {
      if (sampleRaster(deckDist, x, z) < 14) return; // port roads sit on the quay deck
      stampDisk(x, z, core, 12, Math.max(profile[i], 1.5), roadAccW, roadAccH, roadW);
    });
  });
  const h1 = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const w = roadW[k] * shallowGate(h0[k]);
    h1[k] = w > 0 ? mix(h0[k], roadAccH[k] / roadAccW[k], w) : h0[k];
  }

  /* 7. Building pads and civic platforms, feathered into the surrounding ground. */
  const padAccW = new Float32Array(N), padAccH = new Float32Array(N), padW = new Float32Array(N);
  buildings.forEach(b => {
    if (b.district === 'port') return;
    const th = (b.r * Math.PI) / 180;
    const cos = Math.cos(th), sin = Math.sin(th);
    let sum = 0;
    for (const fx of [-0.35, 0, 0.35]) {
      for (const fz of [-0.35, 0, 0.35]) {
        const lx = fx * b.w, lz = fz * b.d;
        sum += sampleRaster(h1, b.x + lx * cos - lz * sin, b.y + lx * sin + lz * cos);
      }
    }
    stampRect(b.x, b.y, b.w / 2 + 2.5, b.d / 2 + 2.5, cos, sin, 8, Math.max(sum / 9, 1.6), padAccW, padAccH, padW);
  });
  let plaza = sampleRaster(h1, 618, 554);
  for (let a = 0; a < 8; a++) plaza += sampleRaster(h1, 618 + Math.cos((a * Math.PI) / 4) * 25, 554 + Math.sin((a * Math.PI) / 4) * 25);
  // Level the park disc, sized to clear market-street (west), central-avenue
  // (east) and south-cross (south, whose sidewalk edge comes within ~51 units)
  // instead of grading into their roadbeds.
  stampDisk(618, 554, 34, 10, plaza / 9, padAccW, padAccH, padW);
  stampDisk(LIGHTHOUSE[0], LIGHTHOUSE[1], 14, 12, sampleRaster(h1, LIGHTHOUSE[0], LIGHTHOUSE[1]), padAccW, padAccH, padW);
  stampDisk(645, 477, 9, 8, sampleRaster(h1, 645, 477), padAccW, padAccH, padW);
  const h2 = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const w = padW[k] * (1 - roadW[k]) * shallowGate(h1[k]);
    h2[k] = deckMask[k] ? -2.2 : w > 0 ? mix(h1[k], padAccH[k] / padAccW[k], w) : h1[k];
  }
  const h = gaussBlur(h2, 1);
  for (let k = 0; k < N; k++) if (deckMask[k]) h[k] = -2.2;

  /* 8. Render mesh nodes and vertex colours. */
  const heights = new Float32Array(MX * MZ);
  const deck = new Uint8Array(MX * MZ);
  for (let mj = 0; mj < MZ; mj++) {
    for (let mi = 0; mi < MX; mi++) {
      const k = mj * STEP * NX + mi * STEP;
      heights[mj * MX + mi] = h[k];
      deck[mj * MX + mi] = deckMask[k];
    }
  }
  const colors = new Float32Array(MX * MZ * 3);
  const c = new THREE.Color();
  for (let mj = 0; mj < MZ; mj++) {
    const z = DZ0 + mj * MESH;
    for (let mi = 0; mi < MX; mi++) {
      const n = mj * MX + mi;
      const k = mj * STEP * NX + mi * STEP;
      const gx = heights[mj * MX + Math.min(MX - 1, mi + 1)] - heights[mj * MX + Math.max(0, mi - 1)];
      const gz = heights[Math.min(MZ - 1, mj + 1) * MX + mi] - heights[Math.max(0, mj - 1) * MX + mi];
      const slope = Math.hypot(gx, gz) / (2 * MESH);
      shadeTerrain(c, DX0 + mi * MESH, z, heights[n], s[k], rock[k], emb[k], beachZone[k] === 1, deckMask[k] === 1, slope, Math.max(roadW[k], padW[k]), eyerZone[k] === 1);
      colors[n * 3] = c.r;
      colors[n * 3 + 1] = c.g;
      colors[n * 3 + 2] = c.b;
    }
  }

  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  deckPolys.forEach(p => p.forEach(([x, z]) => {
    bx0 = Math.min(bx0, x); bz0 = Math.min(bz0, z); bx1 = Math.max(bx1, x); bz1 = Math.max(bz1, z);
  }));
  FIELD = { heights, colors, deck, slab, aprons, deckPolys, deckBox: [bx0, bz0, bx1, bz1] };
  return FIELD;
}

let ROAD_LINES: RoadLine[] | null = null;
function getRoadLines(): RoadLine[] {
  if (!ROAD_LINES) ROAD_LINES = roads.flatMap(road => (road.path.match(/M[^M]*/g) || []).map((part, index) => ({
    id: `${road.id}_${index}`,
    points: samplePath(part, 1.0),
    width: road.width,
    bridge: !!road.bridge,
  })));
  return ROAD_LINES;
}

/** Height of the rendered terrain surface itself (same triangulation as the mesh). */
function meshHeight(field: TerrainField, x: number, z: number) {
  const fx = (x - DX0) / MESH, fz = (z - DZ0) / MESH;
  if (fx < 0 || fz < 0 || fx > MX - 1 || fz > MZ - 1) return -8;
  const c = Math.min(MX - 2, Math.floor(fx)), r = Math.min(MZ - 2, Math.floor(fz));
  const u = fx - c, v = fz - r;
  const hs = field.heights;
  const a = r * MX + c, b = a + MX, d = a + 1, e = b + 1;
  if (u + v <= 1) return hs[a] + (hs[d] - hs[a]) * u + (hs[b] - hs[a]) * v;
  return hs[e] + (hs[b] - hs[e]) * (1 - u) + (hs[d] - hs[e]) * (1 - v);
}

function onPortDeck(field: TerrainField, x: number, z: number) {
  const [x0, z0, x1, z1] = field.deckBox;
  if (x < x0 || x > x1 || z < z0 || z > z1) return false;
  return field.deckPolys.some(p => pointInPoly(x, z, p));
}

/** Softened land outlines in image coordinates, exposed for the minimap preview. */
export function mapOutlines() {
  const field = getTerrainField();
  return {
    main: chaikin(MAIN_ONLY, 2),
    port: field.slab,
    beach: chaikin(beachCoast, 2),
    fort: chaikin(fortCoast, 2),
    shoals: eyerShoals.map(islet => chaikin(islet, 2)),
    channel: portChannelCenterline,
  };
}

/** Ground height (world units) at an image coordinate. Land scales with elevation; the seabed does not. */
export function terrainHeightAt(x: number, z: number, base = 10): number {
  const field = getTerrainField();
  const k = base / 10;
  if (onPortDeck(field, x, z)) return PORT_TOP * k;
  const h = meshHeight(field, x, z);
  return h > 0 ? h * k : h;
}

/* ------------------------------------------------------------------ */
/* Ribbons, walls, paths                                                */
/* ------------------------------------------------------------------ */

type YFn = (x: number, z: number) => number;

function ribbon(runs: Point[][], width: number, y: YFn, yOff = 0) {
  const v: number[] = [];
  const idx: number[] = [];
  runs.forEach(points => {
    if (points.length < 2) return;
    const base = v.length / 3;
    points.forEach(([x, z], i) => {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const ox = (-dz / l) * (width / 2);
      const oz = (dx / l) * (width / 2);
      v.push(x + ox - OX, y(x + ox, z + oz) + yOff, z + oz - OY);
      v.push(x - ox - OX, y(x - ox, z - oz) + yOff, z - oz - OY);
      if (i < points.length - 1) {
        const j = base + i * 2;
        idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
      }
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function wall(points: Point[], bottom: number | YFn, top: number | YFn) {
  const v: number[] = [];
  const idx: number[] = [];
  points.forEach(([x, z], i) => {
    const y0 = typeof bottom === 'function' ? bottom(x, z) : bottom;
    const y1 = typeof top === 'function' ? top(x, z) : top;
    v.push(x - OX, y0, z - OY, x - OX, y1, z - OY);
    if (i < points.length - 1) {
      const n = i * 2;
      idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function normalOffset(points: Point[], dist: number): Point[] {
  return points.map(([x, z], i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [x - (dz / l) * dist, z + (dx / l) * dist] as Point;
  });
}

function inwardOffset(points: Point[], poly: Point[], dist: number): Point[] {
  return points.map(([x, z], i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    let nx = -dz / l, nz = dx / l;
    if (!pointInPoly(x + nx * 2, z + nz * 2, poly)) { nx = -nx; nz = -nz; }
    return [x + nx * dist, z + nz * dist] as Point;
  });
}

/* ------------------------------------------------------------------ */
/* Buildings                                                            */
/* ------------------------------------------------------------------ */

type TexKind = 'office' | 'house' | 'warehouse';

function makeFacadeTexture(kind: TexKind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  if (kind === 'office') {
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 112, 128, 16);
    g.fillStyle = '#6c8696';
    g.fillRect(16, 26, 96, 70);
    g.fillStyle = '#8fa8b6';
    g.fillRect(16, 26, 96, 18);
    g.fillStyle = '#f2f2f2';
    g.fillRect(62, 26, 4, 70);
  } else if (kind === 'house') {
    g.fillStyle = '#7d98a4';
    g.fillRect(40, 30, 48, 62);
    g.fillStyle = '#ffffff';
    g.fillRect(62, 30, 4, 62);
    g.fillRect(40, 58, 48, 4);
    g.fillStyle = '#d6d6d6';
    g.fillRect(34, 92, 60, 6);
  } else {
    g.fillStyle = '#dadada';
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 6, 128);
    g.fillStyle = '#c4c4c4';
    g.fillRect(0, 118, 128, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function facadeBox(w: number, h: number, d: number, bay: number, floor: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const floors = Math.max(1, Math.round(h / floor));
  const widths = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const n = f * 4 + i;
      if (widths[f] === 0) uv.setXY(n, 0.02, 0.02);
      else uv.setXY(n, uv.getX(n) * Math.max(1, Math.round(widths[f] / bay)), uv.getY(n) * floors);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function gableRoof(w: number, d: number, rise: number) {
  const alongX = w >= d;
  const hl = ((alongX ? w : d) * 1.0) / 2;
  const hs = ((alongX ? d : w) * 1.0) / 2;
  const t: number[] = [];
  const tri = (...p: number[]) => t.push(...p);
  tri(-hl, 0, -hs, hl, 0, -hs, hl, rise, 0);
  tri(-hl, 0, -hs, hl, rise, 0, -hl, rise, 0);
  tri(hl, 0, hs, -hl, 0, hs, -hl, rise, 0);
  tri(hl, 0, hs, -hl, rise, 0, hl, rise, 0);
  tri(-hl, 0, -hs, -hl, rise, 0, -hl, 0, hs);
  tri(hl, 0, -hs, hl, 0, hs, hl, rise, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
  g.computeVertexNormals();
  if (!alongX) g.rotateY(Math.PI / 2);
  return g;
}

function hipRoof(w: number, d: number, rise: number) {
  const hw = (w * 1.0) / 2, hd = (d * 1.0) / 2;
  const t: number[] = [];
  const tri = (...p: number[]) => t.push(...p);
  tri(-hw, 0, -hd, hw, 0, -hd, 0, rise, 0);
  tri(hw, 0, -hd, hw, 0, hd, 0, rise, 0);
  tri(hw, 0, hd, -hw, 0, hd, 0, rise, 0);
  tri(-hw, 0, hd, -hw, 0, -hd, 0, rise, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
  g.computeVertexNormals();
  return g;
}

function flatRoof(w: number, d: number) {
  const g = new THREE.BoxGeometry(w, 0.6, d);
  g.translate(0, 0.3, 0);
  return g;
}

const PALETTES: Record<District, { walls: string[]; roofs: string[]; trim: string }> = {
  downtown: { walls: ['#efe6d3', '#e8dcc6', '#dfd8c9', '#f2ede1', '#e3cfb4', '#d9d2c4', '#ecd8c4'], roofs: ['#8c5f4e', '#6b7479', '#9a6a57', '#5f6a70'], trim: '#cfc8b8' },
  north: { walls: ['#f3ead9', '#ecdcc2', '#e8cdb0', '#e2e6df', '#f0dccb'], roofs: ['#b8604f', '#a95546', '#c26f55', '#6f7f86'], trim: '#ddd3c1' },
  port: { walls: ['#cfc9ba', '#c3baa6', '#b8c1bf', '#d4bfa4', '#aab3b1'], roofs: ['#6c7576', '#7b8a91', '#9b6a55', '#5e6769'], trim: '#9b968a' },
  beach: { walls: ['#f5ecd8', '#f0dcbc', '#dcebe5', '#f2d2c3'], roofs: ['#c9a46f', '#5f9a9a', '#b87a5b'], trim: '#efe6d1' },
  lighthouse: { walls: ['#f3ead9'], roofs: ['#b8604f'], trim: '#ddd3c1' },
  fort: { walls: ['#c6bba2', '#b9ad93', '#cfc5ad', '#aea288'], roofs: ['#7d7468', '#6b6459', '#8a8072'], trim: '#a89e8a' },
  spaceport: { walls: ['#e4e8ea', '#d6dce0', '#cfd6da', '#eaeff1'], roofs: ['#9aa4ab', '#7f8b93', '#b0bac0'], trim: '#c3ccd2' },
};
const HEIGHT_MULT: Record<District, number> = { downtown: 1, north: 0.85, port: 0.8, beach: 0.7, lighthouse: 1, fort: 0.75, spaceport: 1.05 };

/* ------------------------------------------------------------------ */
/* Island                                                               */
/* ------------------------------------------------------------------ */

export interface IslandModel {
  root: THREE.Group;
  layers: Map<LayerId, THREE.Group>;
  materials: Record<string, THREE.MeshStandardMaterial>;
  water: THREE.Mesh;
  apply: (settings: SceneSettings) => void;
  dispose: () => void;
  triangles: number;
  sampleHeight: (x: number, z: number, terrainHeight?: number) => number;
  sampleRoadHeight: (x: number, z: number, terrainHeight?: number) => number | null;
}

export function createIsland(settings: SceneSettings): IslandModel {
  const root = new THREE.Group();
  root.name = 'Coastal_Island_Map';
  root.userData = {
    source: 'Refined game-ready map built on the original 1448 x 1086 layout',
    alignment: 'Footprint, roads, bridges, and districts preserved from the traced blockout',
    scale: '1 image pixel = 1 meter (assumed game scale)',
  };

  const field = getTerrainField();
  const baseH = settings.terrainHeight;
  const k0 = baseH / 10;
  const H = (x: number, z: number) => terrainHeightAt(x, z, baseH);

  const layers = new Map<LayerId, THREE.Group>();
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const textures: Record<TexKind, THREE.CanvasTexture> = {
    office: makeFacadeTexture('office'),
    house: makeFacadeTexture('house'),
    warehouse: makeFacadeTexture('warehouse'),
  };

  const std = (color: string, offset = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({
      color, roughness: 0.92, metalness: 0,
      polygonOffset: offset !== 0, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset, ...extra,
    });
  const materials: Record<string, THREE.MeshStandardMaterial> = {
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    // Polygon offsets MUST mirror the physical stacking order. Ranking these
    // randomly lets a lower surface win the depth test and swallow a road — that
    // is what hid the port asphalt behind the quay deck in perspective views.
    // Order, bottom to top: structure > deck > kerb/walk > asphalt > markings.
    walk: std('#d9d4c4', 3, { side: THREE.DoubleSide }),
    walkSide: std('#b9af9f', 2, { side: THREE.DoubleSide }),
    curb: std('#c6c1b1', 3, { side: THREE.DoubleSide }),
    curbSide: std('#8f8778', 2, { side: THREE.DoubleSide }),
    roads: std(settings.colors.roads, 4, { side: THREE.DoubleSide }),
    markings: std('#e6e3d2', 5, { side: THREE.DoubleSide }),
    quay: std('#b9b3a4', 1, { side: THREE.DoubleSide }),
    seawall: std('#98938a', 0, { side: THREE.DoubleSide, roughness: 0.85 }),
    tide: std('#6f6b62', 2, { side: THREE.DoubleSide, roughness: 0.9 }),
    concrete: std('#c9c4b6', 2, { side: THREE.DoubleSide }),
    plaza: std('#b3c49f', 3),
    plazaEdge: std('#d8d3c1', 4),
    fountain: std('#7fb5c4', 6, { roughness: 0.3 }),
    lampWhite: std('#f4f0e6', 0),
    lampRed: std('#c4574a', 0),
    glass: std('#cfe3ec', 0, { roughness: 0.25, emissive: new THREE.Color('#fff2b8'), emissiveIntensity: 0.35 }),
    water: new THREE.MeshStandardMaterial({ color: settings.colors.water, roughness: 0.55, metalness: 0 }),
    waterSide: new THREE.MeshStandardMaterial({ color: settings.colors.water, roughness: 1 }),
    waterGrid: new THREE.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, roughness: 0.55, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }),
  };
  const originalColors: Record<string, THREE.Color> = {};
  Object.entries(materials).forEach(([n, m]) => { originalColors[n] = m.color.clone(); });
  const WATER_NAMES = new Set(['water', 'waterSide', 'waterGrid']);

  const bmat = (hex: string, tex: TexKind | null, rough = 0.9, double = false) => {
    const key = `${hex}|${tex}|${double}`;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0, map: tex ? textures[tex] : null, side: double ? THREE.DoubleSide : THREE.FrontSide });
      m.userData.baseHex = hex;
      m.userData.map = m.map;
      matCache.set(key, m);
    }
    return m;
  };

  const addLayer = (id: LayerId, parent: THREE.Group = root) => {
    const group = new THREE.Group();
    group.name = id;
    group.userData.layer = id;
    layers.set(id, group);
    parent.add(group);
    return group;
  };
  const terrain = addLayer('terrain');
  const roadGroup = addLayer('roads');
  const bridgeGroup = addLayer('bridges');
  const masses = addLayer('buildings');
  (['downtown', 'north', 'port', 'beach', 'lighthouse', 'fort', 'spaceport'] as District[]).forEach(id => addLayer(id, masses));
  const ocean = addLayer('water');

  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], parent: THREE.Group, name: string, opts: { cast?: boolean; receive?: boolean } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = opts.cast ?? false;
    mesh.receiveShadow = opts.receive ?? true;
    mesh.userData.layer = parent.userData.layer;
    parent.add(mesh);
    return mesh;
  };
  /** Geometry baked at the initial elevation; vertically scaled when elevation changes. */
  const addBaked = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], parent: THREE.Group, name: string, cast = false) => {
    const mesh = addMesh(geometry, material, parent, name, { cast });
    mesh.userData.baked = true;
    return mesh;
  };
  /** Object whose Y follows the terrain at a fixed ground point. */
  const addSurface = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group, name: string, gx: number, gz: number, lift: number, cast = false) => {
    const mesh = addMesh(geometry, material, parent, name, { cast });
    mesh.position.set(gx - OX, H(gx, gz) + lift, gz - OY);
    mesh.userData.isSurface = true;
    mesh.userData.groundX = gx;
    mesh.userData.groundZ = gz;
    mesh.userData.groundLift = lift;
    return mesh;
  };
  const addLandmark = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group, name: string, gx: number, gz: number, lift: number) => {
    const mesh = addMesh(geometry, material, parent, name, { cast: true });
    mesh.position.set(gx - OX, H(gx, gz) + lift, gz - OY);
    mesh.userData.isLandmark = true;
    mesh.userData.groundX = gx;
    mesh.userData.groundZ = gz;
    mesh.userData.groundLift = lift;
    return mesh;
  };

  /* ---- Terrain: one continuous surface from hilltop to seabed ---- */
  const { heights, colors: terrainColors, deck } = field;
  const remap = new Int32Array(MX * MZ).fill(-1);
  const tPos: number[] = [], tCol: number[] = [], tBase: number[] = [], tIndex: number[] = [];
  const vertex = (n: number) => {
    let v = remap[n];
    if (v < 0) {
      v = tBase.length;
      remap[n] = v;
      const hb = heights[n];
      tPos.push(DX0 + (n % MX) * MESH - OX, hb > 0 ? hb * k0 : hb, DZ0 + Math.floor(n / MX) * MESH - OY);
      tCol.push(terrainColors[n * 3], terrainColors[n * 3 + 1], terrainColors[n * 3 + 2]);
      tBase.push(hb);
    }
    return v;
  };
  // Cull only seabed that is never visible and ground hidden beneath the quay deck.
  const visibleTri = (a: number, b: number, c: number) =>
    !(heights[a] < CULL_DEPTH && heights[b] < CULL_DEPTH && heights[c] < CULL_DEPTH) && !(deck[a] && deck[b] && deck[c]);
  for (let r = 0; r < MZ - 1; r++) {
    for (let c = 0; c < MX - 1; c++) {
      const a = r * MX + c, b = a + MX, d = a + 1, e = b + 1;
      if (visibleTri(a, b, d)) tIndex.push(vertex(a), vertex(b), vertex(d));
      if (visibleTri(d, b, e)) tIndex.push(vertex(d), vertex(b), vertex(e));
    }
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(tCol, 3));
  terrainGeo.setIndex(tIndex);
  terrainGeo.computeVertexNormals();
  const terrainMesh = addMesh(terrainGeo, materials.terrain, terrain, 'Island_Terrain', { cast: true });
  const terrainBase = Float32Array.from(tBase);
  let terrainK = k0;

  /* ---- Port: flat engineered deck founded on retaining walls ---- */
  const quayTop = PORT_TOP * k0;
  const extrudeDeck = (poly: Point[][], top: number) => {
    const shape = new THREE.Shape();
    poly[0].slice(0, -1).forEach(([x, z], n) => {
      if (n === 0) shape.moveTo(x - OX, OY - z);
      else shape.lineTo(x - OX, OY - z);
    });
    shape.closePath();
    poly.slice(1).forEach(ring => {
      const hole = new THREE.Path();
      ring.slice(0, -1).forEach(([x, z], n) => {
        if (n === 0) hole.moveTo(x - OX, OY - z);
        else hole.lineTo(x - OX, OY - z);
      });
      hole.closePath();
      shape.holes.push(hole);
    });
    const geo = new THREE.ExtrudeGeometry(shape, { depth: top - WALL_FOOT, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, WALL_FOOT, 0);
    return geo;
  };
  // A darker wet band at the waterline grounds the walls in the sea.
  const tideLine = (run: Point[], poly: Point[], name: string) => {
    const mesh = addMesh(wall(inwardOffset(run, poly, -0.06), -0.3, 0.45), materials.tide, terrain, name);
    mesh.userData.isWaterSurface = true;
  };
  // The quay aprons overlap the port land polygon. Unioning them BEFORE
  // extrusion removes the hidden internal walls and top-face z-fighting that
  // appeared as long white seams and beige wedges across the harbor road.
  // deckPolys already include the road-support margins generated in the terrain
  // field, so the visible quay and the road clipping boundary are identical.
  const quayInputs = field.deckPolys.map(poly => [poly]);
  const wholeQuay: MultiPolygon = polygonClipping.union(quayInputs[0], ...quayInputs.slice(1));
  wholeQuay.forEach((poly, i) => {
    addBaked(extrudeDeck(poly, quayTop), [materials.quay, materials.seawall], terrain, `Port_Quay_Deck_${i + 1}`, true);
    poly.forEach((ring, ringIndex) => {
      const outline = ring.slice(0, -1) as Point[];
      if (outline.length < 3) return;
      const run = [...outline, outline[0]];
      // The extrusion itself supplies the retaining face. There must NOT be
      // another coincident wall over it; only the waterline and a coping cap.
      if (ringIndex === 0) {
        const cap = inwardOffset(run, outline, 0.8);
        addBaked(ribbon([cap], 1.5, () => quayTop + 0.14), materials.concrete, terrain, `Port_Coping_${i + 1}`);
        tideLine(run, outline, `Port_Tide_Line_${i + 1}`);
      }
    });
  });

  /* ---- Joined, terrain-conforming road network ---- */
  const network = createRoadNetwork(getRoadLines(), terrainHeightAt, { x: DX0, z: DZ0, cell: MESH }, field.deckPolys, PORT_TOP, baseH);
  network.surfaces.forEach(surface => {
    const mesh = addMesh(surface.geometry, materials[surface.material], surface.layer === 'bridges' ? bridgeGroup : roadGroup, surface.name, { cast: surface.kind === 'face' });
    // Explicit ordering is a fallback for coplanar driver quirks; physical height
    // still supplies the real clearance above the quay deck.
    mesh.renderOrder = surface.material === 'markings' ? 8 : surface.material === 'roads' ? 7 : 6;
  });
  root.userData.roadGeometryChecks = network.checks;

  const structureBindings: { geometry: THREE.BufferGeometry; bridge: BridgeProfile; offsets: Float32Array }[] = [];
  const bridgeSupports: { mesh: THREE.Mesh; bridge: BridgeProfile; point: Point }[] = [];
  const bridgeStructure = (geometry: THREE.BufferGeometry, profile: BridgeProfile, name: string) => {
    const positions = geometry.attributes.position;
    const offsets = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) offsets[i] = positions.getY(i) - network.supportHeight(positions.getX(i) + OX, positions.getZ(i) + OY, baseH);
    structureBindings.push({ geometry, bridge: profile, offsets });
    return addMesh(geometry, materials.concrete, bridgeGroup, name, { cast: true });
  };
  network.bridges.forEach(bridge => {
    const { points, width, id } = bridge.line;
    const top: YFn = (x, z) => network.supportHeight(x, z, baseH) + 0.18;
    bridgeStructure(ribbon([points], width + 3.6, top, -1.25), bridge, `${id}_soffit`);
    const railSetback = Math.min(10, bridge.length * 0.22);
    const rails = points.filter((_, i) => bridge.distances[i] >= railSetback && bridge.distances[i] <= bridge.length - railSetback);
    [-1, 1].forEach(side => {
      const edge = normalOffset(points, side * (width / 2 + 1.8));
      bridgeStructure(wall(edge, (x, z) => top(x, z) - 1.25, (x, z) => top(x, z) + 0.08), bridge, `${id}_girder_${side}`);
      if (rails.length < 2) return;
      const rail = normalOffset(rails, side * (width / 2 + 1.2));
      bridgeStructure(wall(rail, (x, z) => top(x, z) + 0.08, (x, z) => top(x, z) + 1.1), bridge, `${id}_parapet_${side}`);
      bridgeStructure(ribbon([rail], 0.55, top, 1.1), bridge, `${id}_cap_${side}`);
    });
    for (let i = 8; i < points.length - 7; i += 16) {
      const [x, z] = points[i];
      if (H(x, z) > top(x, z) - 2) continue;
      [-1, 1].forEach(side => {
        const p = normalOffset(points.slice(i - 1, i + 2), side * (width / 2 - 1.2))[1];
        const mesh = addMesh(new THREE.CylinderGeometry(0.95, 1.15, 1, 10), materials.concrete, bridgeGroup, `${id}_pier_${i}_${side}`, { cast: true });
        mesh.position.set(p[0] - OX, 0, p[1] - OY);
        bridgeSupports.push({ mesh, bridge, point: p });
      });
    }
  });
  let structureElevation = baseH;
  const updateRoadNetwork = (elevation: number) => {
    network.update(elevation);
    if (structureElevation !== elevation) {
      structureBindings.forEach(({ geometry, offsets }) => {
        const p = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) p.setY(i, network.supportHeight(p.getX(i) + OX, p.getZ(i) + OY, elevation) + offsets[i]);
        p.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      });
      structureElevation = elevation;
    }
    bridgeSupports.forEach(({ mesh, point: [x, z] }) => {
      const top = network.supportHeight(x, z, elevation) + 0.18 - 1.25;
      const bottom = Math.min(terrainHeightAt(x, z, elevation), 0) - 0.6;
      mesh.scale.y = Math.max(0.1, top - bottom);
      mesh.position.y = (top + bottom) / 2;
    });
  };

  /* ---- Jetties: start at the shoreline and run level just above the water ---- */
  piers.forEach((pier, i) => {
    const raw = samplePath(pier.path, 2);
    const isPort = pointInPoly(raw[0][0], raw[0][1], portCoast);
    const deckLevel = isPort ? quayTop + 0.06 : 1.9 * k0;
    const start = isPort ? 0 : raw.findIndex(([x, z]) => H(x, z) < deckLevel + 1.8);
    if (start < 0) return;
    const pts = raw.slice(Math.max(0, start - 1));
    if (pts.length < 2) return;
    const y: YFn = isPort ? () => deckLevel : (x, z) => Math.max(H(x, z) + 0.22, deckLevel);
    addBaked(ribbon([pts], pier.width + 1.2, y, -0.05), materials.seawall, roadGroup, `Pier_Edge_${i + 1}`);
    addBaked(ribbon([pts], pier.width, y, 0.02), materials.quay, roadGroup, `Pier_Deck_${i + 1}`, true);
    for (let n = 3; n < pts.length - 1; n += 5) {
      const [x, z] = pts[n];
      const ground = H(x, z);
      const top = y(x, z);
      if (ground > top - 0.6) continue;
      const bottom = Math.min(ground, 0) - 0.5;
      const geo = new THREE.BoxGeometry(1.2, top - bottom, 1.2);
      geo.translate(x - OX, (top + bottom) / 2, z - OY);
      addBaked(geo, materials.seawall, roadGroup, `Pier_Post_${i + 1}_${n}`);
    }
  });

  /* ---- Central Park: one continuous green with a promenade ring and the fountain ----
   * Sized to stay inside the merged plot. Nearest bounding-street pavement
   * edges: market-street ~63 units west, central-avenue ~59 east, south-cross
   * ~51 south (its centerline dips to ~58 at one point). A 42/46 radius clears
   * all three with a margin of at least 5 units. */
  {
    const px = 618, pz = 554;
    const ring = new THREE.RingGeometry(42, 46, 64);
    ring.rotateX(-Math.PI / 2);
    addSurface(ring, materials.plazaEdge, terrain, 'Park_Promenade', px, pz, 0.12);
    const lawn = new THREE.CircleGeometry(42, 64);
    lawn.rotateX(-Math.PI / 2);
    addSurface(lawn, materials.plaza, terrain, 'Park_Lawn', px, pz, 0.1);
    addSurface(new THREE.CylinderGeometry(7.5, 8, 0.9, 28), materials.plazaEdge, terrain, 'Fountain_Basin', px, pz, 0.45);
    addSurface(new THREE.CylinderGeometry(6.4, 6.4, 0.5, 28), materials.fountain, terrain, 'Fountain_Water', px, pz, 0.75);
    addSurface(new THREE.CylinderGeometry(0.9, 1.3, 3.2, 12), materials.plazaEdge, terrain, 'Fountain_Pedestal', px, pz, 1.9, true);
  }
  /* ---- Buildings ---- */
  const placeBuilding = (b: Building, i: number) => {
    const parent = layers.get(b.district)!;
    const h = b.h * HEIGHT_MULT[b.district];
    const rot = (-b.r * Math.PI) / 180;
    const pal = PALETTES[b.district];
    const wallHex = pal.walls[Math.floor(hash(i + 1) * pal.walls.length)];
    const roofHex = pal.roofs[Math.floor(hash(i + 31) * pal.roofs.length)];
    // Keep the massing on its plot: never let the footprint or lot pad sit on the street.
    const fitted = network.fitBuilding(b.x, b.y, b.w, b.d, b.r);
    const bx = fitted.x, by = fitted.y, bw = fitted.w, bd = fitted.d;
    const g = H(bx, by);
    const hw = bw / 2, hd = bd / 2;
    const gmin = Math.min(g, H(bx + hw, by + hd), H(bx - hw, by + hd), H(bx + hw, by - hd), H(bx - hw, by - hd));
    const plinth = Math.max(1.4, g - gmin + 1.2);

    const found = addMesh(new THREE.BoxGeometry(bw, 1, bd), materials.walk, parent, `${b.district}_lot_${i}`);
    found.position.set(bx - OX, g + 0.2 - plinth / 2, by - OY);
    found.scale.y = plinth;
    found.rotation.y = rot;
    found.userData.isFoundation = true;
    found.userData.groundX = bx;
    found.userData.groundZ = by;
    found.userData.depth = plinth;

    const tex: TexKind = b.district === 'port' ? 'warehouse' : b.district === 'downtown' ? 'office' : 'house';
    const bay = tex === 'warehouse' ? 5 : tex === 'office' ? 5.5 : 4.5;
    const floor = tex === 'warehouse' ? 6 : tex === 'office' ? 3.6 : 3.2;

    const segments: { w: number; d: number; h: number; hex: string }[] = [];
    if (b.district === 'downtown' && h >= 26) {
      segments.push({ w: bw, d: bd, h: 3.6, hex: pal.trim });
      const tower = h - 3.6;
      if (h >= 38) {
        segments.push({ w: bw * 0.88, d: bd * 0.88, h: tower * 0.78, hex: wallHex });
        segments.push({ w: bw * 0.7, d: bd * 0.7, h: tower * 0.22, hex: wallHex });
      } else segments.push({ w: bw * 0.88, d: bd * 0.88, h: tower, hex: wallHex });
    } else segments.push({ w: bw, d: bd, h, hex: wallHex });

    let lift = 0.35;
    let lastW = bw, lastD = bd;
    segments.forEach((s, n) => {
      const mesh = addMesh(facadeBox(s.w, s.h, s.d, bay, floor), bmat(s.hex, tex), parent, `${b.district}_body_${i}_${n}`, { cast: true });
      mesh.position.set(bx - OX, g + lift, by - OY);
      mesh.rotation.y = rot;
      mesh.userData.isBuilding = true;
      mesh.userData.groundX = bx;
      mesh.userData.groundZ = by;
      mesh.userData.lift = lift;
      lift += s.h;
      lastW = s.w;
      lastD = s.d;
    });

    const small = Math.min(lastW, lastD);
    let roofGeo: THREE.BufferGeometry;
    const flat = (b.district === 'downtown' && h >= 28) || (b.district === 'north' && h > 22) || (b.district === 'port' && h >= 20 && small > 16);
    if (flat) roofGeo = flatRoof(lastW, lastD);
    else if (b.district === 'beach') roofGeo = hipRoof(lastW, lastD, THREE.MathUtils.clamp(small * 0.3, 2, 4));
    else if (b.district === 'port') roofGeo = gableRoof(lastW, lastD, THREE.MathUtils.clamp(small * 0.14, 1.6, 3.4));
    else roofGeo = gableRoof(lastW, lastD, THREE.MathUtils.clamp(small * 0.28, 2, 6.5));
    const roofColor = flat ? '#7b8284' : roofHex;
    const roof = addMesh(roofGeo, bmat(roofColor, null, 0.85, true), parent, `${b.district}_roof_${i}`, { cast: true });
    roof.position.set(bx - OX, g + lift, by - OY);
    roof.rotation.y = rot;
    roof.userData.isBuilding = true;
    roof.userData.groundX = bx;
    roof.userData.groundZ = by;
    roof.userData.lift = lift;

    if (flat && b.district === 'downtown' && h > 30) {
      const eqGeo = new THREE.BoxGeometry(lastW * 0.3, 2.4, lastD * 0.3);
      eqGeo.translate(0, 1.2, 0);
      const eq = addMesh(eqGeo, bmat(pal.trim, null), parent, `${b.district}_plant_${i}`, { cast: true });
      eq.position.set(bx - OX, g + lift + 0.6, by - OY);
      eq.rotation.y = rot;
      eq.userData.isBuilding = true;
      eq.userData.groundX = bx;
      eq.userData.groundZ = by;
      eq.userData.lift = lift + 0.6;
    }
  };
  buildings.forEach(placeBuilding);

  /* ---- Lighthouse on the headland summit (the terrain itself forms the headland) ---- */
  {
    const lh = layers.get('lighthouse')!;
    const lx = LIGHTHOUSE[0], lz = LIGHTHOUSE[1];
    const radiusAt = (y: number) => 5.2 - (5.2 - 3.4) * (y / 38);
    addLandmark(new THREE.CylinderGeometry(11, 12.5, 1.2, 28), materials.walk, lh, 'Lighthouse_Terrace', lx, lz, 0);
    addLandmark(new THREE.CylinderGeometry(7.5, 8.5, 3, 24), materials.lampWhite, lh, 'Lighthouse_Plinth', lx, lz, 2.1);
    addLandmark(new THREE.CylinderGeometry(3.4, 5.2, 38, 24), materials.lampWhite, lh, 'Lighthouse_Tower', lx, lz, 3.6 + 19);
    [[8, 12], [18, 22], [28, 32]].forEach(([a, c], n) => {
      addLandmark(new THREE.CylinderGeometry(radiusAt(c) + 0.12, radiusAt(a) + 0.12, c - a, 24), materials.lampRed, lh, `Lighthouse_Band_${n + 1}`, lx, lz, 3.6 + (a + c) / 2);
    });
    addLandmark(new THREE.CylinderGeometry(5.6, 5.6, 0.8, 24), materials.lampWhite, lh, 'Lighthouse_Gallery', lx, lz, 42.0);
    addLandmark(new THREE.CylinderGeometry(3.0, 3.0, 4.6, 16), materials.glass, lh, 'Lighthouse_Lantern', lx, lz, 44.7);
    addLandmark(new THREE.ConeGeometry(4.0, 3.8, 16), materials.lampRed, lh, 'Lighthouse_Cap', lx, lz, 48.9);
  }
  {
    const dt = layers.get('downtown')!;
    const cx = 645, cz = 477;
    addLandmark(new THREE.CylinderGeometry(8, 9, 2.4, 24), materials.walk, dt, 'Civic_Base', cx, cz, 1.1);
    addLandmark(new THREE.CylinderGeometry(3.2, 4, 26, 20), materials.lampWhite, dt, 'Civic_Tower', cx, cz, 15);
    addLandmark(new THREE.CylinderGeometry(4.6, 3.2, 3.6, 20), bmat('#8a6754', null), dt, 'Civic_Crown', cx, cz, 29.8);
    addLandmark(new THREE.ConeGeometry(3.4, 4, 20), bmat('#8a6754', null), dt, 'Civic_Spire', cx, cz, 33.6);
  }

  /* ---- Old Fort: bastioned rampart crowning the promontory ---- */
  {
    const ft = layers.get('fort')!;
    const fx = FORT[0], fz = FORT[1];
    const stone = bmat('#b8ac93', null, 0.95);
    const stoneDark = bmat('#9a8f78', null, 0.95);
    // Octagonal rampart ring built from a Shape with a courtyard hole.
    const octPoints = (r: number) => Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    });
    const ringPrism = (outer: number, inner: number, h: number) => {
      const shape = new THREE.Shape(octPoints(outer));
      shape.holes.push(new THREE.Path(octPoints(inner)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, -h / 2, 0);
      return g;
    };
    addLandmark(new THREE.CylinderGeometry(16.5, 17.5, 3, 8), stone, ft, 'Fort_Terreplein', fx, fz, 1.5);
    addLandmark(ringPrism(12, 8.5, 5), stoneDark, ft, 'Fort_Rampart', fx, fz, 5.5);
    addLandmark(new THREE.CylinderGeometry(8, 8, 0.6, 8), materials.walk, ft, 'Fort_Parade', fx, fz, 3.3);
    // Four corner bastions project from the rampart at the diagonal vertices.
    [[8.5, -8.5], [8.5, 8.5], [-8.5, 8.5], [-8.5, -8.5]].forEach(([dx, dz], n) => {
      addLandmark(new THREE.BoxGeometry(6.5, 5, 6.5), stoneDark, ft, `Fort_Bastion_${n + 1}`, fx + dx, fz + dz, 5.5);
    });
    addLandmark(new THREE.BoxGeometry(6, 15, 6), stone, ft, 'Fort_Keep', fx, fz, 10.5);
    addLandmark(new THREE.BoxGeometry(4, 2, 4), stoneDark, ft, 'Fort_Keep_Cap', fx, fz, 19);
    addLandmark(new THREE.BoxGeometry(6, 5.5, 3.5), stoneDark, ft, 'Fort_Gate', fx, fz + 10.25, 5.75);
  }

  /* ---- Space Centre: launch pad, gantry and support works on the terrace ---- */
  {
    const sp = layers.get('spaceport')!;
    const px = SPACE_CENTER[0], pz = SPACE_CENTER[1];
    const padMat = bmat('#c9cdd0', null, 0.9);
    const steel = bmat('#8f9aa2', null, 0.7);
    const accent = bmat('#d9894f', null, 0.8);
    addLandmark(new THREE.CylinderGeometry(18, 18.5, 0.6, 24), padMat, sp, 'Launch_Apron', px, pz, 0.3);
    addLandmark(new THREE.CylinderGeometry(10, 10.5, 1.4, 24), steel, sp, 'Launch_Pad', px, pz, 1.2);
    addLandmark(new THREE.CylinderGeometry(3.2, 3.8, 3.2, 12), accent, sp, 'Launch_Mount', px, pz, 3.3);
    addLandmark(new THREE.BoxGeometry(5, 3, 5), steel, sp, 'Gantry_Base', px + 14, pz - 10, 1.5);
    addLandmark(new THREE.CylinderGeometry(1.1, 1.4, 22, 10), steel, sp, 'Gantry_Mast', px + 14, pz - 10, 13);
    addLandmark(new THREE.BoxGeometry(9, 1.6, 2.4), accent, sp, 'Gantry_Arm', px + 9, pz - 10, 17);
  }

  /* ---- Water: open-sea volume plus a depth-shaded surface around the islands ---- */
  const water = addMesh(
    new THREE.BoxGeometry(4400, 14, 3800),
    [materials.waterSide, materials.waterSide, materials.water, materials.waterSide, materials.waterSide, materials.waterSide],
    ocean, 'Placeholder_Water_Volume', { receive: false },
  );
  water.position.y = settings.waterLevel - 7;

  const nodeCount = MX * MZ;
  const wPos = new Float32Array(nodeCount * 3);
  const wNor = new Float32Array(nodeCount * 3);
  for (let n = 0; n < nodeCount; n++) {
    wPos[n * 3] = DX0 + (n % MX) * MESH - OX;
    wPos[n * 3 + 2] = DZ0 + Math.floor(n / MX) * MESH - OY;
    wNor[n * 3 + 1] = 1;
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
  waterGeo.setAttribute('normal', new THREE.BufferAttribute(wNor, 3));
  const wColor = new THREE.BufferAttribute(new Float32Array(nodeCount * 3), 3).setUsage(THREE.DynamicDrawUsage);
  waterGeo.setAttribute('color', wColor);
  const wIndex = new THREE.BufferAttribute(new Uint32Array((MX - 1) * (MZ - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
  waterGeo.setIndex(wIndex);
  waterGeo.computeBoundingSphere();
  const waterSurface = addMesh(waterGeo, materials.waterGrid, ocean, 'Water_Surface', { receive: false });
  const waterDepth = new Float32Array(nodeCount);
  const FOAM = new THREE.Color('#eef8f2'), MID = new THREE.Color('#43b4bf'), SHALLOW = new THREE.Color('#a3e3d6');
  const wDeep = new THREE.Color(), wMid = new THREE.Color(), wShallow = new THREE.Color(), wc = new THREE.Color();
  let waterKey = '';
  const updateWater = (next: SceneSettings) => {
    waterSurface.position.y = next.waterLevel + 0.03;
    const key = `${next.waterLevel}|${next.terrainHeight}|${next.colors.water}`;
    if (key === waterKey) return;
    waterKey = key;
    const kk = next.terrainHeight / 10;
    wDeep.set(next.colors.water);
    wMid.copy(wDeep).lerp(MID, 0.55);
    wShallow.copy(wDeep).lerp(SHALLOW, 0.85);
    const col = wColor.array as Float32Array;
    for (let n = 0; n < nodeCount; n++) {
      const hb = heights[n];
      const d = next.waterLevel - (hb > 0 ? hb * kk : hb);
      waterDepth[n] = d;
      if (d <= 0.12) wc.copy(FOAM);
      else if (d < 0.6) wc.copy(FOAM).lerp(wShallow, sm((d - 0.12) / 0.48));
      else if (d < 2.4) wc.copy(wShallow).lerp(wMid, sm((d - 0.6) / 1.8));
      else if (d < DEEP_WATER) wc.copy(wMid).lerp(wDeep, sm((d - 2.4) / (DEEP_WATER - 2.4)));
      else wc.copy(wDeep);
      col[n * 3] = wc.r;
      col[n * 3 + 1] = wc.g;
      col[n * 3 + 2] = wc.b;
    }
    wColor.needsUpdate = true;
    const idx = wIndex.array as Uint32Array;
    let count = 0;
    for (let r = 0; r < MZ - 1; r++) {
      for (let c = 0; c < MX - 1; c++) {
        const a = r * MX + c, b = a + MX, d = a + 1, e = b + 1;
        if (deck[a] && deck[b] && deck[d] && deck[e]) continue;
        const da = waterDepth[a], db = waterDepth[b], dd = waterDepth[d], de = waterDepth[e];
        if (da < -0.3 && db < -0.3 && dd < -0.3 && de < -0.3) continue; // under dry land
        if (da >= DEEP_WATER && db >= DEEP_WATER && dd >= DEEP_WATER && de >= DEEP_WATER) continue; // open sea
        idx[count++] = a; idx[count++] = b; idx[count++] = d;
        idx[count++] = d; idx[count++] = b; idx[count++] = e;
      }
    }
    wIndex.clearUpdateRanges();
    wIndex.addUpdateRange(0, Math.max(count, 1));
    wIndex.needsUpdate = true;
    waterGeo.setDrawRange(0, count);
  };

  /* ---- Settings ---- */
  const CLAY = new THREE.Color('#d6d2c6');
  const apply = (next: SceneSettings) => {
    layers.forEach((group, id) => { group.visible = next.visibility[id]; });
    const clay = next.renderMode === 'clay';
    const wire = next.renderMode === 'wireframe';
    const waterC = new THREE.Color(next.colors.water);
    const tint = new THREE.Color(next.colors.buildings);

    Object.entries(materials).forEach(([name, mat]) => {
      if (name === 'water') mat.color.copy(waterC);
      else if (name === 'waterSide') mat.color.copy(waterC).multiplyScalar(0.7);
      else if (name === 'waterGrid') mat.color.copy(originalColors.waterGrid);
      else if (name === 'terrain') {
        const vc = !clay;
        if (mat.vertexColors !== vc) { mat.vertexColors = vc; mat.needsUpdate = true; }
        mat.color.set(clay ? '#d6d2c6' : next.colors.terrain);
      } else if (clay) mat.color.copy(CLAY);
      else if (name === 'roads') mat.color.set(next.colors.roads);
      else mat.color.copy(originalColors[name]);
      mat.wireframe = wire && !WATER_NAMES.has(name);
    });
    matCache.forEach(m => {
      if (clay) m.color.copy(CLAY);
      else m.color.set(m.userData.baseHex).multiply(tint);
      const map = clay ? null : (m.userData.map as THREE.Texture | null);
      if (m.map !== map) { m.map = map; m.needsUpdate = true; }
      m.wireframe = wire;
    });

    // Land rises and falls with the elevation control; the waterline and seabed stay put.
    const kNext = next.terrainHeight / 10;
    if (Math.abs(kNext - terrainK) > 1e-6) {
      const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < terrainBase.length; i++) {
        const hb = terrainBase[i];
        pos.setY(i, hb > 0 ? hb * kNext : hb);
      }
      pos.needsUpdate = true;
      terrainGeo.computeVertexNormals();
      terrainGeo.computeBoundingSphere();
      terrainGeo.computeBoundingBox();
      terrainK = kNext;
    }

    const scaleY = next.terrainHeight / Math.max(0.001, baseH);
    const bs = next.buildingScale;
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object === terrainMesh || object === waterSurface) return;
      const u = object.userData;
      if (u.isWaterSurface) object.position.y = next.waterLevel;
      else if (u.baked) object.scale.y = scaleY;
      else if (u.isBuilding) {
        object.scale.y = bs;
        object.position.y = terrainHeightAt(u.groundX, u.groundZ, next.terrainHeight) + u.lift * bs;
      } else if (u.isFoundation) {
        const d = u.depth * scaleY;
        object.scale.y = d;
        object.position.y = terrainHeightAt(u.groundX, u.groundZ, next.terrainHeight) + 0.2 - d / 2;
      } else if (u.isLandmark) {
        object.scale.y = bs;
        object.position.y = terrainHeightAt(u.groundX, u.groundZ, next.terrainHeight) + u.groundLift * bs;
      } else if (u.isSurface) {
        object.position.y = terrainHeightAt(u.groundX, u.groundZ, next.terrainHeight) + u.groundLift;
      }
    });
    updateRoadNetwork(next.terrainHeight);
    updateWater(next);
    water.position.y = next.waterLevel - 7;
  };
  apply(settings);

  let triangles = 0;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const g = object.geometry;
    const total = g.index ? g.index.count : g.attributes.position.count;
    triangles += Math.min(total, g.drawRange.count) / 3;
  });

  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
    geometries.forEach(geo => geo.dispose());
    Object.values(materials).forEach(m => m.dispose());
    matCache.forEach(m => m.dispose());
    Object.values(textures).forEach(t => t.dispose());
  };

  return {
    root, layers, materials, water, apply, dispose, triangles,
    sampleHeight: (x, z, terrainHeight = settings.terrainHeight) => terrainHeightAt(x, z, terrainHeight),
    sampleRoadHeight: (x, z, terrainHeight = settings.terrainHeight) => network.sampleHeight(x, z, terrainHeight),
  };
}
