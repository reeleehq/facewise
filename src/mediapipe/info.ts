/**
 * What the MediaPipe backends give, as data, and the files they need. Importing this
 * never loads MediaPipe itself.
 */
import type { BackendInfo } from '../schema';

/** Model files, their source and checksum (`npx facewise-assets <public dir>` fetches them). */
export const MODELS = {
  'blaze_face_full_range.tflite': {
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite',
    sha256: '3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b',
  },
  'blaze_face_short_range.tflite': {
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    sha256: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f',
  },
  'face_landmarker.task': {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
} as const;
export type ModelFile = keyof typeof MODELS;

const common = {
  kind: 'on-device',
  privacy: { imageLeavesDevice: false, thirdPartyHosts: [] },
  license: { code: 'Apache-2.0', weights: 'Apache-2.0' },
} as const;

export const detectorInfo: BackendInfo = {
  ...common,
  id: 'mediapipe-face-detector',
  displayName: 'MediaPipe Face Detector (BlazeFace)',
  modes: ['image', 'video', 'live'],
  emits: {
    keypoints: ['rightEye', 'leftEye', 'noseTip', 'mouthCenter', 'rightEar', 'leftEar'],
    mesh: null,
    pose: false,
    blendshapes: false,
    quality: [],
    embedding: null,
    trackIds: false,
    score: true,
  },
  privacy: { ...common.privacy, thirdPartyHosts: [] },
};

export const landmarkerInfo: BackendInfo = {
  ...common,
  id: 'mediapipe-face-landmarker',
  displayName: 'MediaPipe Face Landmarker (478-point mesh)',
  modes: ['image', 'video', 'live'],
  emits: {
    keypoints: ['rightEye', 'leftEye', 'noseTip', 'mouthCenter', 'mouthRight', 'mouthLeft', 'rightEar', 'leftEar'],
    mesh: 'mediapipe-478',
    pose: true,
    blendshapes: true,
    quality: [],
    embedding: null,
    trackIds: false,
    score: false,
  },
  privacy: { ...common.privacy, thirdPartyHosts: [] },
};
