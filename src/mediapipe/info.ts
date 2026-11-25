/**
 * What the MediaPipe backends give, as data, and the files they need. Importing this
 * never loads MediaPipe itself.
 */
import type { BackendInfo } from '../schema';

import models from '../../assets/models.json';

/** Model files, their source and checksum (`npx facewise-assets <public dir>` fetches them; SSOT: assets/models.json). */
export const MODELS = models.mediapipe;
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
  modes: ['image'], // video and live: reeleehq/facewise#1
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
  modes: ['image'], // video and live: reeleehq/facewise#1
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
