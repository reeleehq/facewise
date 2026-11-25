/**
 * `detect(image)`: every face in one image, through the one path every backend goes through.
 *
 * In order: privacy gate → wanted outputs and mode checked against the backend's declared
 * capabilities → (lazy, cached per assets and mode) load → native call → normalise →
 * post-filters (`minScore`, `maxFaces`) → notes → the native result attached as
 * non-enumerable `raw`. Video's `track()` (reeleehq/facewise#1) reuses `_run` per frame.
 */
import type { AssetResolver, BackendSession, CallOptions, FaceBackend, ImageInput, Mode } from './backend';
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

const _sessions = new WeakMap<FaceBackend, Map<AssetResolver, Map<Mode, Promise<BackendSession>>>>();

/** A loaded session for (backend, assets, mode), cached; a failed load is retried next time. */
export function _session(backend: FaceBackend, { assets = sameOrigin, mode = 'image' }: { assets?: AssetResolver; mode?: Mode } = {}): Promise<BackendSession> {
  let byAssets = _sessions.get(backend);
  if (!byAssets) _sessions.set(backend, (byAssets = new Map()));
  let byMode = byAssets.get(assets);
  if (!byMode) byAssets.set(assets, (byMode = new Map()));
  let s = byMode.get(mode);
  if (!s) {
    s = backend.load({ assets, mode }).catch((e) => {
      byMode!.delete(mode);
      throw e;
    });
    byMode.set(mode, s);
  }
  return s;
}

/** Close every session of `backend` (frees wasm and GPU memory); the next call reloads it. */
export async function release(backend: FaceBackend): Promise<void> {
  const byAssets = _sessions.get(backend);
  _sessions.delete(backend);
  if (!byAssets) return;
  for (const byMode of byAssets.values()) for (const s of byMode.values()) await s.then((x) => x.close(), () => {});
}

function _emits(info: BackendInfo, want: Want): boolean {
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

/** Infos of the backends shipped with facewise, to name alternatives in errors. */
async function _knownBackends(): Promise<BackendInfo[]> {
  // seam candidate: a static ledger of backend infos once a second backend ships (reeleehq/facewise#3)
  const { detectorInfo, landmarkerInfo } = await import('./mediapipe/info');
  return [detectorInfo, landmarkerInfo];
}

/** Raise unless the backend may run here, in this mode, and gives every wanted output. */
export async function _check(info: BackendInfo, { want = [], allowRemote = false, mode = 'image' }: { want?: Want[]; allowRemote?: boolean; mode?: Mode }): Promise<void> {
  if (info.privacy.imageLeavesDevice && !allowRemote)
    throw new FacePrivacyError(`facewise: backend '${info.id}' sends the image off the device; pass allowRemote: true to allow it.`);
  if (!info.modes.includes(mode)) throw new FaceCapabilityError(`facewise: backend '${info.id}' does not run in ${mode} mode (it supports: ${info.modes.join(', ')}).`);
  const missing = want.filter((w) => !_emits(info, w));
  if (missing.length) {
    const alt = (await _knownBackends()).filter((k) => missing.every((w) => _emits(k, w))).map((k) => k.id);
    throw new FaceCapabilityError(`facewise: backend '${info.id}' does not give ${missing.join(', ')}.` + (alt.length ? ` These do: ${alt.join(', ')}.` : ''));
  }
}

/** One call through a loaded session: call, normalise, post-filters, notes, raw. Shared by every verb. */
export async function _run(
  s: BackendSession,
  info: BackendInfo,
  image: ImageInput,
  { minScore, maxFaces, native, signal, onProgress, t }: CallOptions,
): Promise<FaceResult> {
  signal?.throwIfAborted();
  const size = imageSize(image);
  const nativeResult = await s.call(image, { minScore, maxFaces, native, signal, onProgress, t });
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

let _default: Promise<FaceBackend> | null = null;
/** The default backend, imported on first use so an app that passes its own never loads it. */
function _defaultBackend(): Promise<FaceBackend> {
  return (_default ??= (async () => {
    const [{ faceDetector }, { tiled }] = await Promise.all([import('./mediapipe/index'), import('./tiled')]);
    return tiled(faceDetector());
  })());
}

export async function detect(image: ImageInput, opts: DetectOptions = {}): Promise<FaceResult> {
  const { want, allowRemote, assets, ...call } = opts;
  const backend = opts.backend ?? (await _defaultBackend());
  await _check(backend.info, { want, allowRemote, mode: 'image' });
  const s = await _session(backend, { assets, mode: 'image' });
  return _run(s, backend.info, image, call);
}
