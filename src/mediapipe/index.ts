/**
 * MediaPipe backends (`facewise/mediapipe`): the BlazeFace face detector and the
 * 478-point face landmarker. `@mediapipe/tasks-vision` is imported on first use only,
 * and its wasm runtime and models are fetched through the asset resolver (the page's
 * own origin by default: no CDN).
 */
import type { BackendSession, FaceBackend, ImageInput } from '../backend';
import type { DetectedFace, Keypoints, Point, Pose } from '../schema';
import { detectorInfo, landmarkerInfo, type ModelFile } from './info';

export { detectorInfo, landmarkerInfo, MODELS } from './info';

type Delegate = 'CPU' | 'GPU';

// MediaPipe's own result shapes (the subset used), so the library's types are not needed here.
interface MpDetection {
  boundingBox?: { originX: number; originY: number; width: number; height: number };
  categories?: { score: number }[];
  keypoints?: { x: number; y: number }[];
}
interface MpLandmarks {
  faceLandmarks: { x: number; y: number; z: number }[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { data: number[] | Float32Array }[];
}

async function _fileset(wasmBase: string) {
  const vision = await import('@mediapipe/tasks-vision');
  return { vision, fileset: await vision.FilesetResolver.forVisionTasks(wasmBase) };
}

/** Detector keypoint order (MediaPipe docs): the subject's right eye, left eye, nose tip, mouth, right ear, left ear. */
const DETECTOR_KEYPOINTS = ['rightEye', 'leftEye', 'noseTip', 'mouthCenter', 'rightEar', 'leftEar'] as const;

export interface FaceDetectorOptions {
  /** `full-range` (back-camera photos, faces up to ~5 m; default) or `short-range` (selfies). */
  model?: 'full-range' | 'short-range';
  delegate?: Delegate;
  minDetectionConfidence?: number;
  /** Folder of the wasm runtime, for the asset resolver. */
  runtimePath?: string;
  /** Folder of the models, for the asset resolver. */
  modelPath?: string;
}

export function faceDetector(options: FaceDetectorOptions = {}): FaceBackend<MpDetection[]> {
  const { model = 'full-range', delegate = 'CPU', minDetectionConfidence = 0.4, runtimePath = 'mediapipe/', modelPath = 'models/' } = options;
  const file: ModelFile = model === 'full-range' ? 'blaze_face_full_range.tflite' : 'blaze_face_short_range.tflite';
  return {
    info: detectorInfo,
    options: { model, delegate, minDetectionConfidence, runtimePath, modelPath },
    async load({ assets }): Promise<BackendSession<MpDetection[]>> {
      // IMAGE mode only: VIDEO (detectForVideo with ctx.mode / CallOptions.t) is reeleehq/facewise#1.
      const { vision, fileset } = await _fileset(assets('runtime', runtimePath));
      const det = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: assets('model', modelPath + file), delegate },
        runningMode: 'IMAGE',
        minDetectionConfidence,
      });
      return {
        call: async (image: ImageInput) => det.detect(image as HTMLCanvasElement).detections as MpDetection[],
        normalise: (dets, { width, height }) =>
          dets.map((d): DetectedFace => {
            const b = d.boundingBox ?? { originX: 0, originY: 0, width: 0, height: 0 };
            const keypoints: Keypoints = {};
            (d.keypoints ?? []).forEach((p, i) => i < DETECTOR_KEYPOINTS.length && (keypoints[DETECTOR_KEYPOINTS[i]] = { x: p.x, y: p.y }));
            // MediaPipe mixes units: the box is in pixels, the keypoints are normalised.
            return { box: { x: b.originX / width, y: b.originY / height, w: b.width / width, h: b.height / height }, score: d.categories?.[0]?.score ?? null, keypoints };
          }),
        close: () => det.close(),
      };
    },
  };
}

/** Indices into the 478-point mesh for the named keypoints (subject's left/right). */
export const MESH_KEYPOINTS = {
  rightEye: [468],
  leftEye: [473],
  noseTip: [1],
  mouthCenter: [13, 14],
  mouthRight: [61],
  mouthLeft: [291],
  rightEar: [234],
  leftEar: [454],
} as const;

const RAD2DEG = 180 / Math.PI;

/**
 * Head pose from MediaPipe's column-major 4x4 facial transformation matrix (intrinsic
 * Y-X-Z, as three.js `'YXZ'`). Ported from an in-house webcam app's `matrixToHeadPose`.
 * The facade's signs (roll > 0 clockwise as displayed) are pinned by the conformance test.
 */
export function matrixToPose(data: ArrayLike<number>): Pose {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const [m11, m21, m31] = [data[0], data[1], data[2]];
  const [m22, m13, m23, m33] = [data[5], data[8], data[9], data[10]];
  const pitch = Math.asin(-clamp(m23));
  let yaw: number;
  let roll: number;
  if (Math.abs(m23) < 0.9999999) {
    yaw = Math.atan2(m13, m33);
    roll = Math.atan2(m21, m22);
  } else {
    yaw = Math.atan2(-m31, m11);
    roll = 0;
  }
  const deg = (r: number) => (r === 0 ? 0 : r * RAD2DEG);
  // MediaPipe's canonical frame has y up; on screen y is down, so roll flips sign.
  return { yaw: deg(yaw), pitch: deg(pitch), roll: -deg(roll) || 0 };
}

export function landmarksToFace(points: { x: number; y: number; z: number }[]): DetectedFace {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const avg = (ix: readonly number[]): Point => {
    const ps = ix.map((i) => points[i]).filter(Boolean);
    return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
  };
  const keypoints = Object.fromEntries(
    Object.entries(MESH_KEYPOINTS)
      .filter(([, ix]) => ix.every((i) => points[i]))
      .map(([k, ix]) => [k, avg(ix)]),
  ) as Keypoints;
  return {
    box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    score: null,
    keypoints,
    mesh: { topology: 'mediapipe-478', points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })) },
  };
}

export interface FaceLandmarkerOptions {
  numFaces?: number;
  delegate?: Delegate;
  minFaceDetectionConfidence?: number;
  blendshapes?: boolean;
  pose?: boolean;
  runtimePath?: string;
  modelPath?: string;
}

export function faceLandmarker(options: FaceLandmarkerOptions = {}): FaceBackend<MpLandmarks> {
  const { numFaces = 20, delegate = 'CPU', minFaceDetectionConfidence = 0.4, blendshapes = true, pose = true, runtimePath = 'mediapipe/', modelPath = 'models/' } = options;
  return {
    info: landmarkerInfo,
    options: { numFaces, delegate, minFaceDetectionConfidence, blendshapes, pose, runtimePath, modelPath },
    async load({ assets }): Promise<BackendSession<MpLandmarks>> {
      const { vision, fileset } = await _fileset(assets('runtime', runtimePath));
      const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: assets('model', modelPath + 'face_landmarker.task'), delegate },
        runningMode: 'IMAGE',
        numFaces,
        minFaceDetectionConfidence,
        outputFaceBlendshapes: blendshapes,
        outputFacialTransformationMatrixes: pose,
      });
      return {
        call: async (image: ImageInput) => lm.detect(image as HTMLCanvasElement) as unknown as MpLandmarks,
        normalise: (r) =>
          r.faceLandmarks.map((pts, i) => {
            const f = landmarksToFace(pts);
            const m = r.facialTransformationMatrixes?.[i]?.data;
            if (m && m.length >= 11) f.pose = matrixToPose(m);
            const cats = r.faceBlendshapes?.[i]?.categories;
            if (cats?.length) f.blendshapes = Object.fromEntries(cats.map((c) => [c.categoryName, c.score]));
            return f;
          }),
        close: () => lm.close(),
      };
    },
  };
}
