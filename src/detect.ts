/**
 * `detect(image)`: every face in one image, through the one path every backend goes through.
 *
 * In order: privacy gate → wanted outputs checked against the backend's declared
 * capabilities → (lazy, cached) load → native call → normalise → post-filters
 * (`minScore`, `maxFaces`) → notes → the native result attached as non-enumerable `raw`.
 */
import type { AssetResolver, BackendSession, FaceBackend, ImageInput } from './backend';
import { FaceCapabilityError, FacePrivacyError, imageSize, sameOrigin } from './backend';
import type { BackendInfo, FaceResult, Want } from './schema';
import { SCHEMA_ID } from './schema';

export interface DetectOptions {
  /** Default: the MediaPipe full-range detector, tiled (loaded on first use). */
  backend?: FaceBackend;
  /** Outputs beyond box and score. One the backend cannot give raises. */
  want?: Want[];
  minScore?: number;
  maxFaces?: number;
  native?: Record<string, unknown>;
  /** A backend that sends the image off the device refuses to run without this. */
  allowRemote?: boolean;
  assets?: AssetResolver;
  signal?: AbortSignal;
  /** Progress of a long call (a tiled scan reports tiles done of total). */
  onProgress?: (done: number, total: number) => void;
}

const _sessions = new WeakMap<FaceBackend, Promise<BackendSession>>();

/** Load a backend once; a failed load is retried on the next call. */
export function session(backend: FaceBackend, assets: AssetResolver = sameOrigin): Promise<BackendSession> {
  let s = _sessions.get(backend);
  if (!s) {
    s = backend.load({ assets }).catch((e) => {
      _sessions.delete(backend);
      throw e;
    });
    _sessions.set(backend, s);
  }
  return s;
}

export function emitsWant(info: BackendInfo, want: Want): boolean {
  const e = info.emits;
  switch (want) {
    case 'keypoints':
      return e.keypoints.length > 0;
    case 'mesh':
      return e.mesh !== null;
    case 'embedding':
      return e.embedding !== null;
    case 'quality':
      return e.quality.length > 0;
    default:
      return e[want];
  }
}

/** Raise unless the backend may run here and gives every wanted output. */
export function checkCall(info: BackendInfo, { want = [], allowRemote = false }: Pick<DetectOptions, 'want' | 'allowRemote'>, known: BackendInfo[] = []): void {
  if (info.privacy.imageLeavesDevice && !allowRemote)
    throw new FacePrivacyError(`facewise: backend '${info.id}' sends the image off the device; pass allowRemote: true to allow it.`);
  const missing = want.filter((w) => !emitsWant(info, w));
  if (missing.length) {
    const alt = known.filter((k) => missing.every((w) => emitsWant(k, w))).map((k) => k.id);
    throw new FaceCapabilityError(
      `facewise: backend '${info.id}' does not give ${missing.join(', ')}.` + (alt.length ? ` These do: ${alt.join(', ')}.` : ''),
    );
  }
}

let _default: Promise<FaceBackend> | null = null;
/** The default backend, imported on first use so an app that passes its own never loads it. */
export function defaultBackend(): Promise<FaceBackend> {
  return (_default ??= (async () => {
    const [{ faceDetector }, { tiled }] = await Promise.all([import('./mediapipe/index'), import('./tiled')]);
    return tiled(faceDetector());
  })());
}

/** Infos of the backends shipped with facewise, for error messages that name alternatives. */
export async function knownBackends(): Promise<BackendInfo[]> {
  const { detectorInfo, landmarkerInfo } = await import('./mediapipe/info');
  return [detectorInfo, landmarkerInfo];
}

export async function detect(image: ImageInput, opts: DetectOptions = {}): Promise<FaceResult> {
  const { want = [], minScore, maxFaces, native, allowRemote, assets = sameOrigin, signal, onProgress } = opts;
  const backend = opts.backend ?? (await defaultBackend());
  const { info } = backend;
  if (want.some((w) => !emitsWant(info, w))) checkCall(info, { want, allowRemote }, await knownBackends());
  checkCall(info, { want, allowRemote });
  signal?.throwIfAborted();

  const s = await session(backend, assets);
  signal?.throwIfAborted();
  const size = imageSize(image);
  const nativeResult = await s.call(image, { minScore, maxFaces, native, signal, onProgress });
  let faces = s.normalise(nativeResult, size);

  const notes: string[] = [];
  if (native && Object.keys(native).length) notes.push(`native options passed to ${info.id}: ${Object.keys(native).join(', ')}`);
  if (minScore !== undefined) {
    const before = faces.length;
    faces = faces.filter((f) => f.score === null || f.score >= minScore);
    if (faces.length < before) notes.push(`minScore ${minScore} dropped ${before - faces.length} face(s)`);
  }
  if (maxFaces !== undefined && faces.length > maxFaces) {
    notes.push(`maxFaces ${maxFaces} kept the top ${maxFaces} of ${faces.length}`);
    faces = [...faces].sort((a, b) => (b.score ?? 1) - (a.score ?? 1)).slice(0, maxFaces);
  }
  const result: FaceResult = { schema: SCHEMA_ID, backend: info.id, image: size, faces, notes };
  Object.defineProperty(result, 'raw', { value: nativeResult, enumerable: false });
  return result;
}
