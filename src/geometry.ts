/**
 * Pure geometry over the canonical schema: unit conversion, box forms, overlap and
 * merging, tiling a large image, and roll from the eyes. No DOM.
 */
import type { Box, DetectedFace, FaceResult, ImageSize, Point } from './schema';

const _pt = (p: Point, sx: number, sy: number): Point => ({ ...p, x: p.x * sx, y: p.y * sy });

function _scaleFace(f: DetectedFace, sx: number, sy: number): DetectedFace {
  return {
    ...f,
    box: { x: f.box.x * sx, y: f.box.y * sy, w: f.box.w * sx, h: f.box.h * sy },
    keypoints: f.keypoints && Object.fromEntries(Object.entries(f.keypoints).map(([k, p]) => [k, _pt(p!, sx, sy)])),
    mesh: f.mesh && { ...f.mesh, points: f.mesh.points.map((p) => _pt(p, sx, sy)) },
  };
}

/** The same faces in pixels of `result.image` (the canonical form is normalised). */
export function toPixels(result: FaceResult): DetectedFace[] {
  return result.faces.map((f) => _scaleFace(f, result.image.width, result.image.height));
}

/** Faces given in pixels of `image`, normalised. */
export function fromPixels(faces: DetectedFace[], image: ImageSize): DetectedFace[] {
  return faces.map((f) => _scaleFace(f, 1 / image.width, 1 / image.height));
}

export const toXyxy = (b: Box): [number, number, number, number] => [b.x, b.y, b.x + b.w, b.y + b.h];
export const fromXyxy = ([x1, y1, x2, y2]: readonly number[]): Box => ({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });

const _area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);

/** Intersection over the smaller box: 1 when one sits inside the other. */
export function overlapOverMin(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const small = Math.min(_area(a), _area(b));
  return small > 0 ? (ix * iy) / small : 0;
}

/** Intersection over union. */
export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = _area(a) + _area(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Recall-first merge (non-maximum suppression on overlap-over-min). The best-scoring face
 * of a cluster is kept, grown to cover any larger box it suppresses, and takes that
 * larger face's points: a half-face cut by a tile edge that happens to score higher
 * never leaves the other half uncovered. Boxes must share one coordinate frame.
 */
export function mergeFaces(faces: DetectedFace[], { maxOverlap = 0.4 }: { maxOverlap?: number } = {}): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => (b.score ?? 1) - (a.score ?? 1));
  const kept: DetectedFace[] = [];
  for (const f of sorted) {
    const i = kept.findIndex((k) => overlapOverMin(k.box, f.box) >= maxOverlap);
    if (i < 0) kept.push(f);
    else if (_area(f.box) > _area(kept[i].box)) kept[i] = { ...f, box: unionBox(kept[i].box, f.box), score: kept[i].score };
  }
  return kept;
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileOptions {
  /** Finer levels after the whole image (each halves the tile side). */
  levels?: number;
  /** Smallest tile side worth scanning, px. */
  minTile?: number;
  /** Fraction of a tile shared with its neighbour. */
  overlap?: number;
}

function _starts(length: number, tile: number, stride: number): number[] {
  if (tile >= length) return [0];
  const out: number[] = [];
  for (let s = 0; s + tile < length; s += stride) out.push(Math.round(s));
  out.push(Math.round(length - tile));
  return [...new Set(out)];
}

/** Tiles in pixels: the whole image, then overlapping squares at finer scales (SAHI-style). */
export function planTiles(width: number, height: number, { levels = 2, minTile = 320, overlap = 1 / 3 }: TileOptions = {}): Tile[] {
  const tiles: Tile[] = [{ x: 0, y: 0, w: width, h: height }];
  let side = Math.min(width, height);
  for (let k = 0; k < levels; k++) {
    side = Math.round(side / 2);
    if (side < minTile) break;
    const stride = side * (1 - overlap);
    for (const y of _starts(height, side, stride)) for (const x of _starts(width, side, stride)) tiles.push({ x, y, w: side, h: side });
  }
  return tiles;
}

/** A face found in `tile` (normalised to the tile) → normalised to the whole image. */
export function fromTile(f: DetectedFace, tile: Tile, image: ImageSize): DetectedFace {
  const map = (p: Point): Point => ({ ...p, x: (tile.x + p.x * tile.w) / image.width, y: (tile.y + p.y * tile.h) / image.height });
  return {
    ...f,
    box: {
      x: (tile.x + f.box.x * tile.w) / image.width,
      y: (tile.y + f.box.y * tile.h) / image.height,
      w: (f.box.w * tile.w) / image.width,
      h: (f.box.h * tile.h) / image.height,
    },
    keypoints: f.keypoints && Object.fromEntries(Object.entries(f.keypoints).map(([k, p]) => [k, map(p!)])),
    mesh: f.mesh && { ...f.mesh, points: f.mesh.points.map(map) },
  };
}

/**
 * Roll in degrees from the eyes, > 0 when the face turns clockwise as displayed; null
 * without both eyes. Needs the image size because normalised x and y have different units.
 */
export function rollFromEyes(f: DetectedFace, image: ImageSize): number | null {
  const r = f.keypoints?.rightEye;
  const l = f.keypoints?.leftEye;
  if (!r || !l) return null;
  return (Math.atan2((l.y - r.y) * image.height, (l.x - r.x) * image.width) * 180) / Math.PI;
}
