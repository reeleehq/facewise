/**
 * facewise: faces in pictures and video, in the browser, behind one interface.
 *
 * `detect(image)` finds every face in a still and returns a `faces/1` `FaceResult`
 * (normalised boxes, the subject's left/right, scores in [0, 1] or null). Backends are
 * values, loaded on first use: the default is MediaPipe's full-range face detector,
 * tiled; `facewise/mediapipe` also has the 478-point landmarker.
 */
export * from './schema';
export * from './geometry';
export type { AssetResolver, BackendSession, CallOptions, FaceBackend, ImageInput, LoadContext, Mode } from './backend';
export { FaceCapabilityError, FacePrivacyError, imageSize, sameOrigin } from './backend';
export { detect, release, type DetectOptions } from './detect';
export { tiled, type TiledOptions } from './tiled';
export { fixtureBackend } from './fixture';
export { checkBackend, type ConformanceReport, type Fixture } from './conformance';
