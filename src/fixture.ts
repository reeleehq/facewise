/** A deterministic backend for tests: returns the faces it was given, for any image. */
import type { FaceBackend } from './backend';
import type { BackendInfo, DetectedFace } from './schema';

export function fixtureBackend(faces: DetectedFace[], info: Partial<BackendInfo> = {}): FaceBackend<DetectedFace[]> {
  return {
    info: {
      id: 'fixture',
      displayName: 'Fixture (tests)',
      kind: 'on-device',
      modes: ['image', 'video', 'live'],
      emits: { keypoints: ['rightEye', 'leftEye'], mesh: null, pose: false, blendshapes: false, quality: [], embedding: null, trackIds: false, score: true },
      privacy: { imageLeavesDevice: false, thirdPartyHosts: [] },
      license: { code: 'MIT', weights: 'none' },
      ...info,
    },
    options: { faces },
    async load() {
      return { call: async () => faces, normalise: (f) => f, close: () => {} };
    },
  };
}
