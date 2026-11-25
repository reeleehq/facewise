/**
 * What a backend is: its capabilities as data, plus a lazy `load` that returns a session.
 * A session makes the native call and normalises its output, nothing else: options,
 * privacy, wanted outputs and post-filters are enforced once, in `detect`, so no
 * adapter can skip them.
 */
import type { BackendInfo, DetectedFace, ImageSize } from './schema';

/** Anything a canvas can draw (all browser image types, video frames included). */
export type ImageInput = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | VideoFrame | ImageData | HTMLVideoElement;

/** Where a backend's runtime and model files are served from. Default: the page's own origin. */
export type AssetResolver = (kind: 'runtime' | 'model', path: string) => string;

export interface CallOptions {
  /** Canonical options the backend can apply natively (core post-filters anyway). */
  minScore?: number;
  maxFaces?: number;
  /** Untranslated options for this backend (escape hatch). */
  native?: Record<string, unknown>;
  /** Stop a long call (a tiled scan checks it between tiles). */
  signal?: AbortSignal;
  /** Progress of a long call, as steps done of total. */
  onProgress?: (done: number, total: number) => void;
}

export interface BackendSession<Native = unknown> {
  /** The native call. */
  call(image: ImageInput, opts: CallOptions): Promise<Native>;
  /** Pure: native output → canonical faces, normalised to `image`. */
  normalise(native: Native, image: ImageSize): DetectedFace[];
  close(): void;
}

export interface FaceBackend<Native = unknown> {
  info: BackendInfo;
  /** The JSON options the backend was built from (a worker can rebuild it from `{id, options}`). */
  options: Record<string, unknown>;
  load(ctx: { assets: AssetResolver }): Promise<BackendSession<Native>>;
}

export class FaceCapabilityError extends Error {
  name = 'FaceCapabilityError';
}
export class FacePrivacyError extends Error {
  name = 'FacePrivacyError';
}

export function imageSize(image: ImageInput): ImageSize {
  const v = image as { displayWidth?: number; displayHeight?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width: number; height: number };
  const width = v.displayWidth ?? (v.videoWidth || v.naturalWidth || v.width);
  const height = v.displayHeight ?? (v.videoHeight || v.naturalHeight || v.height);
  if (!width || !height) throw new Error('facewise: the image has no size (not loaded yet?)');
  return { width, height };
}

/** Resolves relative to the page (so an app mounted at /app/ serves /app/mediapipe/…). */
export const sameOrigin: AssetResolver = (_kind, path) =>
  typeof document !== 'undefined' ? new URL(path, document.baseURI).href : new URL(path, (globalThis as { location?: Location }).location?.href).href;
