import * as THREE from 'three';
import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import { REFERENCE, type Point } from './mapData';

export interface RoadLine {
  id: string;
  points: Point[];
  width: number;
  bridge: boolean;
}

type HeightAt = (x: number, z: number, elevation: number) => number;
type SurfaceMaterial = 'roads' | 'curb' | 'walk' | 'curbSide' | 'walkSide' | 'markings';
type SurfaceLayer = 'roads' | 'bridges';
type Bounds = [number, number, number, number];

interface RoadRegion {
  name: string;
  footprint: MultiPolygon;
  material: SurfaceMaterial;
  layer: SurfaceLayer;
  lift: number;
}

interface NearestPoint {
  x: number;
  z: number;
  distance: number;
  along: number;
  side: number;
  segment: number;
  t: number;
}

export interface BridgeProfile {
  line: RoadLine;
  distances: number[];
  length: number;
  heights: number[];
  project: (x: number, z: number) => NearestPoint;
  height: (x: number, z: number, elevation: number) => number;
}

export interface RoadSurface {
  name: string;
  geometry: THREE.BufferGeometry;
  material: SurfaceMaterial;
  layer: SurfaceLayer;
  kind: 'top' | 'face';
}

export interface RoadChecks {
  f2Covered: boolean;
  overlappingPavementArea: number;
  finiteVertices: boolean;
  degenerateTriangles: number;
  minimumGroundClearance: number;
  minimumSidewalkDepth: number;
  bridgeLandingSeam: number;
  bridgeEndpointMismatch: number;
  triangleCount: number;
}

export interface FittedBuilding {
  x: number;
  y: number;
  w: number;
  d: number;
  inset: boolean;
}

export interface RoadNetwork {
  surfaces: RoadSurface[];
  bridges: BridgeProfile[];
  checks: RoadChecks;
  update: (elevation: number) => void;
  sampleHeight: (x: number, z: number, elevation: number) => number | null;
  supportHeight: HeightAt;
  isStreet: (x: number, z: number) => boolean;
  fitBuilding: (x: number, y: number, w: number, d: number, rotationDeg: number) => FittedBuilding;
}

const EPS = 1e-7;
// Physical lifts are large enough to resolve at orbit distance in the
// perspective camera, where depth precision is only ~0.3 m at 1500 m. Kerb and
// sidewalk stay 0.32 m above the carriageway, so the road reads as below grade.
const ASPHALT_LIFT = 0.3;
const CURB_LIFT = 0.62;
const WALK_LIFT = 0.62;
const MARKING_LIFT = ASPHALT_LIFT + 0.06;
const PAVEMENT_BASE = 0.12;
const snap = (n: number) => Math.round(n * 10000) / 10000;
const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };

function area(ring: Point[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function polygonArea(polys: MultiPolygon) {
  return polys.reduce((sum, poly) => sum + Math.abs(area(poly[0])) - poly.slice(1).reduce((holes, ring) => holes + Math.abs(area(ring)), 0), 0);
}

function bounds(polys: MultiPolygon): Bounds {
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  polys.forEach(poly => poly[0].forEach(([x, z]) => {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], z);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], z);
  }));
  return box;
}

function boxesOverlap(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cleanRing(input: Point[]) {
  const out: Point[] = [];
  input.forEach(([x, z]) => {
    const point: Point = [snap(x), snap(z)];
    const previous = out[out.length - 1];
    if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > EPS) out.push(point);
  });
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < EPS) out.pop();
  return out;
}

function union(regions: MultiPolygon[]): MultiPolygon {
  const nonempty = regions.filter(r => r.length);
  return nonempty.length ? polygonClipping.union(nonempty[0], ...nonempty.slice(1)) : [];
}

function difference(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  return a.length && b.length ? polygonClipping.difference(a, b) : a;
}

function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  return a.length && b.length ? polygonClipping.intersection(a, b) : [];
}

function roundPolyCorners(poly: Point[], radius: number, steps = 4): Point[] {
  const out: Point[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const ax = p0[0] - p1[0], az = p0[1] - p1[1];
    const bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-5 || lb < 1e-5) { out.push(p1); continue; }
    const cosA = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
    const angle = Math.acos(cosA);
    if (angle > Math.PI * 0.98 || angle < 0.05) { out.push(p1); continue; }
    const t = Math.min(radius / Math.tan(angle / 2), la * 0.44, lb * 0.44);
    if (t < 0.15) { out.push(p1); continue; }
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

export function roundMultiPolygon(mp: MultiPolygon, radius = 3.5, steps = 4): MultiPolygon {
  return mp.map(poly => poly.map(ring => {
    const cleaned = cleanRing(ring);
    if (cleaned.length < 4) return cleaned;
    return roundPolyCorners(cleaned, radius, steps);
  }));
}

/**
 * Continuous smooth road footprint with round arc joins on the outside of bends
 * and clamped miter joins on the inside. Ensures corners and bends are perfectly
 * rounded circular curves without angular facets or spikes.
 */
export function roadFootprint(points: Point[], width: number): MultiPolygon {
  const path = cleanRing(points);
  if (path.length < 2) return [];
  const sides: Point[][] = [[], []];
  const half = width / 2;
  path.forEach(([x, z], i) => {
    const before = path[Math.max(0, i - 1)], after = path[Math.min(path.length - 1, i + 1)];
    let dx0 = x - before[0], dz0 = z - before[1];
    let dx1 = after[0] - x, dz1 = after[1] - z;
    if (i === 0) { dx0 = dx1; dz0 = dz1; }
    if (i === path.length - 1) { dx1 = dx0; dz1 = dz0; }
    const l0 = Math.hypot(dx0, dz0) || 1, l1 = Math.hypot(dx1, dz1) || 1;
    const nx0 = -dz0 / l0, nz0 = dx0 / l0;
    const nx1 = -dz1 / l1, nz1 = dx1 / l1;
    const cross = (dx0 * dz1 - dz0 * dx1) / (l0 * l1);
    const mx = nx0 + nx1, mz = nz0 + nz1;
    const length = Math.hypot(mx, mz);
    const denominator = length ? (mx * nx1 + mz * nz1) / length : 0;

    sides.forEach((side, index) => {
      const sign = index === 0 ? 1 : -1;
      const isConvex = (sign > 0) === (cross < 0);

      if (isConvex) {
        // Outside of turn: smooth circular arc join
        const ang0 = Math.atan2(nz0 * sign, nx0 * sign);
        const ang1 = Math.atan2(nz1 * sign, nx1 * sign);
        let diff = ang1 - ang0;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (Math.abs(diff) > 0.04) {
          const arcSteps = Math.max(2, Math.ceil(Math.abs(diff) / (Math.PI / 18))); // at most 10° per step
          for (let k = 0; k <= arcSteps; k++) {
            const a = ang0 + (diff * k) / arcSteps;
            side.push([x + half * Math.cos(a), z + half * Math.sin(a)]);
          }
        } else {
          side.push([x + sign * (mx / length) * half, z + sign * (mz / length) * half]);
        }
      } else {
        // Inside of turn: miter point clamped to avoid self-intersection
        const miter = Math.min(half * 1.4, half / Math.max(0.35, denominator));
        side.push([x + sign * (mx / length) * miter, z + sign * (mz / length) * miter]);
      }
    });
  });
  const outline = cleanRing([...sides[0], ...sides[1].reverse()]);
  return outline.length >= 3 ? polygonClipping.union([outline]) : [];
}

function turnaround(radius: number): MultiPolygon {
  const ring: Point[] = Array.from({ length: 32 }, (_, i) => [997 + Math.cos(i * Math.PI / 16) * radius, 266 + Math.sin(i * Math.PI / 16) * radius]);
  return [[ring]];
}

function pathDistances(points: Point[]) {
  const result = [0];
  for (let i = 1; i < points.length; i++) result.push(result[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return result;
}

function projectToPath(points: Point[], distances: number[], x: number, z: number): NearestPoint {
  let best: NearestPoint = { x: points[0][0], z: points[0][1], distance: Infinity, along: 0, side: 0, segment: 0, t: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = distances[i + 1] - distances[i];
    if (length < EPS) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (length * length)));
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < best.distance) best = { x: px, z: pz, distance, along: distances[i] + length * t, side: ((x - px) * -dz + (z - pz) * dx) / length, segment: i, t };
  }
  return best;
}

function bridgeProfile(line: RoadLine, ground: HeightAt): BridgeProfile {
  const pts = line.points, distances = pathDistances(pts), length = distances[distances.length - 1];
  const a = pts[0], b = pts[pts.length - 1];
  const h0 = Math.max(0.7, ground(a[0], a[1], 10));
  const h1 = Math.max(0.7, ground(b[0], b[1], 10));
  const heights = pts.map((_, i) => {
    const t = distances[i] / length;
    return h0 + (h1 - h0) * smooth(t) + Math.min(1.3, length * 0.02) * Math.sin(Math.PI * t) ** 2;
  });
  const project = (x: number, z: number) => projectToPath(pts, distances, x, z);
  return {
    line, distances, length, heights, project,
    height: (x, z, elevation) => {
      const p = project(x, z);
      const profile = (heights[p.segment] + (heights[p.segment + 1] - heights[p.segment]) * p.t) * elevation / 10;
      const actualGround = Math.max(0.7 * elevation / 10, ground(x, z, elevation));
      const startLength = distances[1] || 1;
      const endLength = length - distances[distances.length - 2] || 1;
      const startSide: Point = [a[0] - (pts[1][1] - a[1]) / startLength * p.side, a[1] + (pts[1][0] - a[0]) / startLength * p.side];
      const endSide: Point = [b[0] - (b[1] - pts[pts.length - 2][1]) / endLength * p.side, b[1] + (b[0] - pts[pts.length - 2][0]) / endLength * p.side];
      const startCrossfall = Math.max(0.7, ground(startSide[0], startSide[1], 10)) - h0;
      const endCrossfall = Math.max(0.7, ground(endSide[0], endSide[1], 10)) - h1;
      const rampLength = Math.min(12, length * 0.25);
      const crossfall = startCrossfall * (1 - smooth(p.along / rampLength)) + endCrossfall * (1 - smooth((length - p.along) / rampLength));
      const target = profile + crossfall * elevation / 10;
      // Match every landing vertex to the road, but never follow the seabed
      // through the middle of a span. Blend only within its landward approach.
      const landing = smooth(Math.min(p.along, length - p.along) / Math.min(4, length * 0.1));
      return Math.max(actualGround, actualGround + (target - actualGround) * landing);
    },
  };
}

function insideRing(x: number, z: number, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inside(x: number, z: number, polygons: MultiPolygon) {
  return polygons.some(p => insideRing(x, z, p[0]) && !p.slice(1).some(hole => insideRing(x, z, hole)));
}

function distanceToOutline(x: number, z: number, polygons: MultiPolygon) {
  let best = Infinity;
  polygons.forEach(poly => poly.forEach(ring => {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
  }));
  return best;
}

function pathSlice(points: Point[], distances: number[], start: number, end: number): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = distances[i], b = distances[i + 1];
    if (b < start || a > end || b - a < EPS) continue;
    const lo = Math.max(0, (start - a) / (b - a));
    const hi = Math.min(1, (end - a) / (b - a));
    if (lo > hi) continue;
    if (!result.length) result.push([points[i][0] + (points[i + 1][0] - points[i][0]) * lo, points[i][1] + (points[i + 1][1] - points[i][1]) * lo]);
    result.push([points[i][0] + (points[i + 1][0] - points[i][0]) * hi, points[i][1] + (points[i + 1][1] - points[i][1]) * hi]);
  }
  return result;
}

function clipHalfPlane(points: Point[], nx: number, nz: number, value: number): Point[] {
  if (points.length < 3) return [];
  const out: Point[] = [];
  let previous = points[points.length - 1];
  let pd = nx * previous[0] + nz * previous[1] - value;
  for (const current of points) {
    const cd = nx * current[0] + nz * current[1] - value;
    const pi = pd >= -EPS, ci = cd >= -EPS;
    if (pi !== ci) {
      const t = pd / (pd - cd);
      out.push([previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t]);
    }
    if (ci) out.push(current);
    previous = current; pd = cd;
  }
  return out;
}

// Split pavement at every terrain cell edge AND its diagonal. Within each
// resulting triangle the underlying terrain is planar, so the road cannot cut it.
function terrainAlignedGeometry(footprint: MultiPolygon, sample: (x: number, z: number) => number, grid: { x: number; z: number; cell: number }): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [];
  const welded = new Map<string, number>();
  const addVertex = ([rawX, rawZ]: Point) => {
    const x = snap(rawX), z = snap(rawZ), key = `${x}:${z}`;
    let index = welded.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      welded.set(key, index);
      vertices.push(x - REFERENCE.originX, sample(x, z), z - REFERENCE.originY);
    }
    return index;
  };
  const emit = (piece: Point[]) => {
    const p = cleanRing(piece);
    if (p.length < 3) return;
    for (let i = 1; i < p.length - 1; i++) {
      const cross = (p[i][0] - p[0][0]) * (p[i + 1][1] - p[0][1]) - (p[i][1] - p[0][1]) * (p[i + 1][0] - p[0][0]);
      if (Math.abs(cross) < EPS) continue;
      const a = addVertex(p[0]), b = addVertex(p[i]), c = addVertex(p[i + 1]);
      if (cross > 0) indices.push(a, c, b); else indices.push(a, b, c);
    }
  };
  for (const poly of footprint) {
    const rings = poly.map(cleanRing).filter(r => r.length >= 3);
    if (!rings.length) continue;
    const vectors = rings.map(ring => ring.map(p => new THREE.Vector2(p[0], p[1])));
    const flattened = rings.flat();
    const triangles = THREE.ShapeUtils.triangulateShape(vectors[0], vectors.slice(1));
    for (const ids of triangles) {
      const triangle = ids.map(i => flattened[i]);
      const x0 = Math.min(...triangle.map(p => p[0])), x1 = Math.max(...triangle.map(p => p[0]));
      const z0 = Math.min(...triangle.map(p => p[1])), z1 = Math.max(...triangle.map(p => p[1]));
      const c0 = Math.floor((x0 - grid.x) / grid.cell), c1 = Math.floor((x1 - grid.x) / grid.cell);
      const r0 = Math.floor((z0 - grid.z) / grid.cell), r1 = Math.floor((z1 - grid.z) / grid.cell);
      for (let row = r0; row <= r1; row++) {
        const z = grid.z + row * grid.cell;
        let rowPiece = clipHalfPlane(triangle, 0, 1, z);
        rowPiece = clipHalfPlane(rowPiece, 0, -1, -z - grid.cell);
        if (rowPiece.length < 3) continue;
        const rowC0 = Math.max(c0, Math.floor((Math.min(...rowPiece.map(p => p[0])) - grid.x) / grid.cell));
        const rowC1 = Math.min(c1, Math.floor((Math.max(...rowPiece.map(p => p[0])) - grid.x) / grid.cell));
        for (let col = rowC0; col <= rowC1; col++) {
          const x = grid.x + col * grid.cell;
          let square = clipHalfPlane(rowPiece, 1, 0, x);
          square = clipHalfPlane(square, -1, 0, -x - grid.cell);
          if (square.length < 3) continue;
          const diagonal = x + z + grid.cell;
          emit(clipHalfPlane(square, -1, -1, -diagonal));
          emit(clipHalfPlane(square, 1, 1, diagonal));
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(vertices, 3);
  const cleanIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const cross = (positions.getX(b) - positions.getX(a)) * (positions.getZ(c) - positions.getZ(a)) - (positions.getZ(b) - positions.getZ(a)) * (positions.getX(c) - positions.getX(a));
    if (Math.abs(cross) > 1e-8) cleanIndices.push(a, b, c);
  }
  geometry.setAttribute('position', positions);
  geometry.setIndex(cleanIndices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface PavementEdge {
  geometry: THREE.BufferGeometry;
  offsets: Float32Array;
  onDeck: Uint8Array;
  layer: SurfaceLayer;
}

/** Vertical faces only on true pavement boundaries, never at an artificial bridge/quay split. */
function pavementEdges(
  footprint: MultiPolygon,
  kind: 'walk' | 'curb',
  plan: Plan,
  support: (x: number, z: number, elevation: number, onDeck: boolean) => number,
  gridSize: number,
  elevation: number,
): PavementEdge[] {
  const groups = new Map<SurfaceLayer, { xyz: number[]; offsets: number[]; onDeck: number[]; indices: number[] }>();
  const getGroup = (layer: SurfaceLayer) => {
    let g = groups.get(layer);
    if (!g) { g = { xyz: [], offsets: [], onDeck: [], indices: [] }; groups.set(layer, g); }
    return g;
  };
  footprint.forEach(poly => poly.forEach(ring => {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < EPS) continue;
      const steps = Math.ceil(length / (gridSize / 2));
      for (let step = 0; step < steps; step++) {
        const t0 = step / steps, t1 = (step + 1) / steps;
        const p0: Point = [a[0] + dx * t0, a[1] + dz * t0];
        const p1: Point = [a[0] + dx * t1, a[1] + dz * t1];
        const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        const nx = -dz / length, nz = dx / length;
        // polygon-clipping winds every boundary with the occupied region to
        // its left (including clockwise hole rings). Sample the neighbor to
        // its right instead of testing the whole pavement polygon again.
        const interior: Point = [mx + nx * 0.12, mz + nz * 0.12];
        const right: Point = [mx - nx * 0.12, mz - nz * 0.12];
        const outside = right;
        const asphalt = inside(outside[0], outside[1], plan.asphalt);
        const curb = inside(outside[0], outside[1], plan.curb);
        const walk = inside(outside[0], outside[1], plan.sidewalk);
        // Sidewalk sits at curb height. The visible step down to the road is the
        // curb's inner face (or a sidewalk face if there is no curb strip).
        if (kind === 'walk' && curb) continue;
        const top = kind === 'walk' ? WALK_LIFT : CURB_LIFT;
        const bottom = kind === 'walk'
          ? (asphalt ? ASPHALT_LIFT : PAVEMENT_BASE)
          : (asphalt ? ASPHALT_LIFT : walk ? WALK_LIFT : PAVEMENT_BASE);
        if (top - bottom < 0.005) continue;
        const inBridge = inside(interior[0], interior[1], plan.bridgeArea);
        const layer: SurfaceLayer = inBridge ? 'bridges' : 'roads';
        const group = getGroup(layer);
        const base = group.xyz.length / 3;
        for (const [x, z] of [p0, p1]) {
          const onDeck = inside(x, z, plan.deckArea) ? 1 : 0;
          const y = support(x, z, elevation, !!onDeck);
          group.xyz.push(x - REFERENCE.originX, y + top, z - REFERENCE.originY, x - REFERENCE.originX, y + bottom, z - REFERENCE.originY);
          group.offsets.push(top, bottom);
          group.onDeck.push(onDeck, onDeck);
        }
        group.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
  }));
  return [...groups].map(([layer, group]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(group.xyz, 3));
    geometry.setIndex(group.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return { geometry, offsets: Float32Array.from(group.offsets), onDeck: Uint8Array.from(group.onDeck), layer };
  });
}

interface Plan {
  lines: RoadLine[];
  asphalt: MultiPolygon;
  curb: MultiPolygon;
  sidewalk: MultiPolygon;
  markings: MultiPolygon;
  bridgeArea: MultiPolygon;
  deckArea: MultiPolygon;
  street: MultiPolygon;
}

let cachedPlan: Plan | null = null;

function planRoads(lines: RoadLine[], deckPolys: Point[][]): Plan {
  if (cachedPlan?.lines === lines) return cachedPlan;
  const deckArea = union(deckPolys.map(poly => [[poly]]));
  const onQuay = lines.map(line => {
    const midpoint = line.points[Math.floor(line.points.length / 2)];
    return !line.bridge && inside(midpoint[0], midpoint[1], deckArea);
  });
  const footprint = (line: RoadLine, i: number, width: number) => {
    const shape = roadFootprint(line.points, width);
    // The engineered island ends at its retaining wall. Don't float the port
    // road's sidewalk beyond that edge; only the dedicated bridges cross water.
    return onQuay[i] ? intersection(shape, deckArea) : shape;
  };
  const asphaltByRoad = lines.map((line, i) => footprint(line, i, line.width));
  const curbByRoad = lines.map((line, i) => footprint(line, i, line.width + 1.8));
  const walkByRoad = lines.map((line, i) => footprint(line, i, line.width + (line.bridge ? 3.6 : line.width >= 7 ? 5.2 : 1.8)));
  const rawAsphalt = union([...asphaltByRoad, turnaround(7)]);
  const rawCurbEnvelope = union([...curbByRoad, turnaround(8.8), rawAsphalt]);
  const rawWalkEnvelope = union([...walkByRoad, turnaround(10.6), rawCurbEnvelope]);
  const asphalt = roundMultiPolygon(rawAsphalt, 2.5, 4);
  const curbEnvelope = roundMultiPolygon(rawCurbEnvelope, 3.5, 4);
  const walkEnvelope = roundMultiPolygon(rawWalkEnvelope, 4.5, 4);
  const curb = difference(curbEnvelope, asphalt);
  const sidewalk = difference(walkEnvelope, curbEnvelope);
  const groundEnvelope = union(walkByRoad.filter((_, i) => !lines[i].bridge));
  const bridgeArea = difference(union(walkByRoad.filter((_, i) => lines[i].bridge)), groundEnvelope);

  const curbBounds = curbByRoad.map(bounds);
  const markingRegions: MultiPolygon[] = [];
  lines.forEach((line, i) => {
    if (line.width < 8) return;
    const distances = pathDistances(line.points), length = distances[distances.length - 1];
    const dashes: MultiPolygon[] = [];
    for (let s = 4; s < length - 2; s += 12) dashes.push(roadFootprint(pathSlice(line.points, distances, s, Math.min(s + 6, length - 2)), 0.4));
    const lineMarks = intersection(union(dashes), asphalt);
    const box = bounds(lineMarks);
    const crossings = curbByRoad.filter((_, j) => i !== j && boxesOverlap(box, curbBounds[j]));
    // Stop lane dashes inside other streets' footprints; no artificial roundabout masks.
    markingRegions.push(difference(lineMarks, union(crossings)));
  });
  const markings = union(markingRegions);
  cachedPlan = { lines, asphalt, curb, sidewalk, markings, bridgeArea, deckArea, street: walkEnvelope };
  return cachedPlan;
}

/** Push a rotated plot off the street. Shrinks only as a last resort so massing stays readable. */
export function fitBuildingToPlot(
  x: number, y: number, w: number, d: number, rotationDeg: number,
  blocked: (x: number, z: number) => boolean,
  setback = 1.6,
): FittedBuilding {
  const rot = -rotationDeg * Math.PI / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const toWorld = (lx: number, lz: number, cx = x, cz = y): Point => [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos];
  const hits = (cx: number, cz: number, bw: number, bd: number) => {
    const bad: Point[] = [];
    for (let u = -1; u <= 1; u += 0.5) {
      for (let v = -1; v <= 1; v += 0.5) {
        if (u === 0 && v === 0) continue;
        const p = toWorld(u * (bw / 2 + setback), v * (bd / 2 + setback), cx, cz);
        if (blocked(p[0], p[1])) bad.push(p);
      }
    }
    return bad;
  };
  let cx = x, cz = y, bw = w, bd = d, inset = false;
  for (let iter = 0; iter < 28; iter++) {
    const bad = hits(cx, cz, bw, bd);
    if (!bad.length) break;
    inset = true;
    let hx = 0, hz = 0;
    bad.forEach(([px, pz]) => { hx += px; hz += pz; });
    hx /= bad.length; hz /= bad.length;
    let dx = cx - hx, dz = cz - hz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { dx = cos; dz = sin; }
    else { dx /= len; dz /= len; }
    cx += dx * 0.7;
    cz += dz * 0.7;
    if (iter > 8) {
      bw = Math.max(6, bw * 0.94);
      bd = Math.max(6, bd * 0.94);
    }
  }
  if (hits(cx, cz, bw, bd).length) {
    inset = true;
    bw = Math.max(6, bw * 0.82);
    bd = Math.max(6, bd * 0.82);
  }
  return { x: cx, y: cz, w: bw, d: bd, inset };
}

export function createRoadNetwork(
  lines: RoadLine[],
  ground: HeightAt,
  grid: { x: number; z: number; cell: number },
  deckPolys: Point[][],
  deckLevel: number,
  initialElevation: number,
): RoadNetwork {
  const plan = planRoads(lines, deckPolys);
  const bridges = lines.filter(line => line.bridge).map(line => bridgeProfile(line, ground));
  const bridgeBoxes = bridges.map(b => {
    const box = bounds(roadFootprint(b.line.points, b.line.width + 4 + grid.cell * Math.SQRT2 * 2));
    return box;
  });
  const deckBox = bounds(plan.deckArea);
  const nodeHeights = new Map<string, number>();
  const nodeHeight = (col: number, row: number) => {
    const key = `${col}:${row}`;
    const cached = nodeHeights.get(key);
    if (cached !== undefined) return cached;
    const x = grid.x + col * grid.cell, z = grid.z + row * grid.cell;
    let h = Math.max(ground(x, z, 10), 0.7);
    // A one-cell landing collar avoids interpolating from a quay top down to its
    // underwater foundation at the exact retaining-wall edge.
    const collar = grid.cell * Math.SQRT2 + 0.1;
    if (x >= deckBox[0] - collar && x <= deckBox[2] + collar && z >= deckBox[1] - collar && z <= deckBox[3] + collar) {
      if (inside(x, z, plan.deckArea) || distanceToOutline(x, z, plan.deckArea) <= collar) h = Math.max(h, deckLevel);
    }
    bridges.forEach((bridge, i) => {
      const box = bridgeBoxes[i];
      if (x < box[0] || x > box[2] || z < box[1] || z > box[3]) return;
      const p = bridge.project(x, z);
      if (p.distance > bridge.line.width / 2 + 1.8 + collar) return;
      h = Math.max(h, bridge.height(x, z, 10));
    });
    nodeHeights.set(key, h);
    return h;
  };
  const support = (x: number, z: number, elevation: number, onDeck = false) => {
    const fx = (x - grid.x) / grid.cell, fz = (z - grid.z) / grid.cell;
    const col = Math.floor(fx), row = Math.floor(fz), u = fx - col, v = fz - row;
    let h: number;
    if (u + v <= 1) {
      const a = nodeHeight(col, row);
      h = a + (nodeHeight(col + 1, row) - a) * u + (nodeHeight(col, row + 1) - a) * v;
    } else {
      const e = nodeHeight(col + 1, row + 1);
      h = e + (nodeHeight(col, row + 1) - e) * (1 - u) + (nodeHeight(col + 1, row) - e) * (1 - v);
    }
    return Math.max(onDeck ? deckLevel : 0, h) * elevation / 10;
  };

  const regions: RoadRegion[] = [];
  const split = (name: string, footprint: MultiPolygon, material: SurfaceMaterial, lift: number) => {
    regions.push({ name: `Road_Network_${name}`, footprint: difference(footprint, plan.bridgeArea), material, layer: 'roads', lift });
    regions.push({ name: `Bridge_Network_${name}`, footprint: intersection(footprint, plan.bridgeArea), material, layer: 'bridges', lift });
  };
  split('Asphalt', plan.asphalt, 'roads', ASPHALT_LIFT);
  split('Curbs', plan.curb, 'curb', CURB_LIFT);
  split('Sidewalks', plan.sidewalk, 'walk', WALK_LIFT);
  split('Lane_Markings', plan.markings, 'markings', MARKING_LIFT);

  const surfaces: RoadSurface[] = [];
  const heightBindings: { geometry: THREE.BufferGeometry; lift: number; onDeck: boolean }[] = [];
  const edgeBindings: PavementEdge[] = [];
  regions.forEach(region => {
    for (const onDeck of [false, true]) {
      const footprint = onDeck ? intersection(region.footprint, plan.deckArea) : difference(region.footprint, plan.deckArea);
      if (!footprint.length) continue;
      const geometry = terrainAlignedGeometry(footprint, (x, z) => support(x, z, initialElevation, onDeck) + region.lift, grid);
      if (!geometry.index?.count) { geometry.dispose(); continue; }
      surfaces.push({ name: `${region.name}${onDeck ? '_Quay' : ''}`, geometry, material: region.material, layer: region.layer, kind: 'top' });
      heightBindings.push({ geometry, lift: region.lift, onDeck });
    }
  });
  for (const [name, shape] of [['Sidewalks', plan.sidewalk], ['Curbs', plan.curb]] as const) {
    const material: 'walk' | 'curb' = name === 'Sidewalks' ? 'walk' : 'curb';
    pavementEdges(shape, material, plan, support, grid.cell, initialElevation).forEach(edge => {
      surfaces.push({ name: `${edge.layer === 'bridges' ? 'Bridge' : 'Road'}_Network_${name}_Faces`, geometry: edge.geometry, material: material === 'walk' ? 'walkSide' : 'curbSide', layer: edge.layer, kind: 'face' });
      edgeBindings.push(edge);
    });
  }

  const checks: RoadChecks = {
    f2Covered: inside(788, 164, plan.asphalt),
    overlappingPavementArea: polygonArea(intersection(plan.asphalt, plan.curb)) + polygonArea(intersection(plan.asphalt, plan.sidewalk)) + polygonArea(intersection(plan.curb, plan.sidewalk)),
    finiteVertices: true,
    degenerateTriangles: 0,
    minimumGroundClearance: Infinity,
    minimumSidewalkDepth: Infinity,
    bridgeLandingSeam: 0,
    bridgeEndpointMismatch: 0,
    triangleCount: 0,
  };
  const roadHeights = new Map<string, number>();
  surfaces.forEach(({ geometry, material, kind }) => {
    const p = geometry.attributes.position, index = geometry.index!;
    checks.triangleCount += index.count / 3;
    for (let i = 0; i < p.count; i++) if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) checks.finiteVertices = false;
    if (kind === 'face') return;
    if (material === 'roads') {
      for (let i = 0; i < p.count; i++) {
        const key = `${Math.round(p.getX(i) * 10000)},${Math.round(p.getZ(i) * 10000)}`;
        const earlier = roadHeights.get(key);
        if (earlier !== undefined) checks.bridgeLandingSeam = Math.max(checks.bridgeLandingSeam, Math.abs(earlier - p.getY(i)));
        roadHeights.set(key, p.getY(i));
      }
    }
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const cross = (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a));
      if (Math.abs(cross) < 1e-8) checks.degenerateTriangles++;
      if (material === 'markings') continue;
      const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3 + REFERENCE.originX;
      const z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3 + REFERENCE.originY;
      checks.minimumGroundClearance = Math.min(checks.minimumGroundClearance, (p.getY(a) + p.getY(b) + p.getY(c)) / 3 - ground(x, z, initialElevation));
    }
  });
  bridges.forEach(b => {
    [b.line.points[0], b.line.points[b.line.points.length - 1]].forEach(([x, z]) => {
      checks.bridgeEndpointMismatch = Math.max(checks.bridgeEndpointMismatch, Math.abs(b.height(x, z, initialElevation) - Math.max(ground(x, z, initialElevation), 0.7 * initialElevation / 10)));
    });
  });
  edgeBindings.filter(edge => edge.geometry.index?.count && surfaces.some(surface => surface.geometry === edge.geometry && surface.material === 'walkSide')).forEach(edge => {
    for (let i = 0; i < edge.offsets.length; i += 2) checks.minimumSidewalkDepth = Math.min(checks.minimumSidewalkDepth, edge.offsets[i] - edge.offsets[i + 1]);
  });
  if (!checks.f2Covered || !checks.finiteVertices || checks.overlappingPavementArea > 0.001 || checks.minimumGroundClearance < 0.05 || checks.minimumSidewalkDepth < 0.2 || checks.bridgeLandingSeam > 0.08) {
    console.warn('Road surface geometry needs inspection', checks);
  }

  let lastElevation = initialElevation;
  return {
    surfaces, bridges, checks,
    supportHeight: support,
    update: elevation => {
      if (elevation === lastElevation) return;
      lastElevation = elevation;
      heightBindings.forEach(({ geometry, lift, onDeck }) => {
        const positions = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) positions.setY(i, support(positions.getX(i) + REFERENCE.originX, positions.getZ(i) + REFERENCE.originY, elevation, onDeck) + lift);
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      });
      edgeBindings.forEach(({ geometry, offsets, onDeck }) => {
        const positions = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          positions.setY(i, support(positions.getX(i) + REFERENCE.originX, positions.getZ(i) + REFERENCE.originY, elevation, !!onDeck[i]) + offsets[i]);
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      });
    },
    sampleHeight: (x, z, elevation) => inside(x, z, plan.asphalt) ? support(x, z, elevation, inside(x, z, plan.deckArea)) + ASPHALT_LIFT : null,
    isStreet: (x, z) => inside(x, z, plan.street),
    fitBuilding: (x, y, w, d, rotationDeg) => fitBuildingToPlot(x, y, w, d, rotationDeg, (px, pz) => inside(px, pz, plan.street), 1.8),
  };
}