/**
 * `tiled(backend)`: run any backend over the whole image and overlapping tiles at finer
 * scales, then merge (recall-first). Finds small faces in group photos that a detector
 * with a small input window misses. Wraps a backend; is itself a backend.
 */
import type { FaceBackend, ImageInput } from './backend';
import { imageSize } from './backend';
import { fromTile, mergeFaces, planTiles, type TileOptions } from './geometry';
import type { DetectedFace } from './schema';

export interface TiledOptions extends TileOptions {
  /** Side each tile is scaled to before detection, px. */
  tileInput?: number;
  /** Merge threshold (overlap over the smaller box). */
  maxOverlap?: number;
  /** Called after each tile. */
  onProgress?: (done: number, total: number) => void;
}

function _canvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function tiled(inner: FaceBackend, opts: TiledOptions = {}): FaceBackend<DetectedFace[]> {
  const { tileInput = 640, maxOverlap = 0.4, onProgress, ...tiling } = opts;
  return {
    info: { ...inner.info, id: `tiled(${inner.info.id})`, modes: ['image'] },
    options: { inner: { id: inner.info.id, options: inner.options }, tileInput, maxOverlap, ...tiling },
    async load(ctx) {
      const s = await inner.load(ctx);
      return {
        async call(image: ImageInput, callOpts) {
          const size = imageSize(image);
          const tiles = planTiles(size.width, size.height, tiling);
          const canvas = _canvas(1, 1);
          const ctx2d = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
          const all: DetectedFace[] = [];
          try {
            for (const [i, t] of tiles.entries()) {
              callOpts.signal?.throwIfAborted();
              const k = Math.min(1, tileInput / Math.max(t.w, t.h)) || 1;
              canvas.width = Math.max(1, Math.round(t.w * k));
              canvas.height = Math.max(1, Math.round(t.h * k));
              ctx2d.drawImage(image as CanvasImageSource, t.x, t.y, t.w, t.h, 0, 0, canvas.width, canvas.height);
              const tileSize = { width: canvas.width, height: canvas.height };
              const found = s.normalise(await s.call(canvas as HTMLCanvasElement, { ...callOpts, onProgress: undefined }), tileSize);
              for (const f of found) all.push(fromTile(f, t, size));
              (callOpts.onProgress ?? onProgress)?.(i + 1, tiles.length);
              await new Promise((r) => setTimeout(r, 0)); // let the page paint between tiles
            }
          } finally {
            canvas.width = canvas.height = 0;
          }
          return mergeFaces(all, { maxOverlap });
        },
        normalise: (faces) => faces,
        close: () => s.close(),
      };
    },
  };
}
