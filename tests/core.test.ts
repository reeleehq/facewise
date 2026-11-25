import { describe, expect, it } from 'vitest';
import {
  FaceCapabilityError,
  FacePrivacyError,
  FaceResult,
  detect,
  release,
  fixtureBackend,
  fromPixels,
  fromTile,
  fromXyxy,
  iou,
  mergeFaces,
  overlapOverMin,
  planTiles,
  rollFromEyes,
  toPixels,
  toXyxy,
  type DetectedFace,
} from '../src/index';
import { landmarksToFace, matrixToPose, MESH_KEYPOINTS } from '../src/mediapipe/index';

const face = (x: number, y: number, w: number, h: number, score: number | null = 0.9): DetectedFace => ({ box: { x, y, w, h }, score });
const img = { width: 400, height: 200 } as unknown as ImageBitmap;

describe('detect: the one path', () => {
  it('returns a valid faces/1 result and hides the native result from JSON', async () => {
    const r = await detect(img, { backend: fixtureBackend([face(0.1, 0.1, 0.2, 0.4)]) });
    expect(FaceResult.parse(r)).toEqual(r);
    expect(r).toMatchObject({ schema: 'faces/1', backend: 'fixture', image: { width: 400, height: 200 } });
    expect('raw' in r).toBe(true);
    expect(JSON.parse(JSON.stringify(r)).raw).toBeUndefined();
  });
  it('applies minScore and maxFaces and says so in notes', async () => {
    const faces = [face(0, 0, 0.1, 0.1, 0.9), face(0.5, 0, 0.1, 0.1, 0.3), face(0.2, 0.5, 0.1, 0.1, 0.8), face(0.7, 0.5, 0.1, 0.1, null)];
    const r = await detect(img, { backend: fixtureBackend(faces), minScore: 0.5, maxFaces: 2 });
    expect(r.faces.map((f) => f.score)).toEqual([null, 0.9]);
    expect(r.notes.join(' ')).toMatch(/minScore 0.5 dropped 1/);
    expect(r.notes.join(' ')).toMatch(/maxFaces 2/);
  });
  it('raises for a wanted output the backend does not give, naming backends that do', async () => {
    await expect(detect(img, { backend: fixtureBackend([]), want: ['mesh'] })).rejects.toThrow(FaceCapabilityError);
    await expect(detect(img, { backend: fixtureBackend([]), want: ['mesh'] })).rejects.toThrow(/mediapipe-face-landmarker/);
  });
  it('refuses a backend that sends the image away unless allowed', async () => {
    const remote = fixtureBackend([], { privacy: { imageLeavesDevice: true, thirdPartyHosts: ['api.example.com'] } });
    await expect(detect(img, { backend: remote })).rejects.toThrow(FacePrivacyError);
    await expect(detect(img, { backend: remote, allowRemote: true })).resolves.toMatchObject({ faces: [] });
  });
});

describe('sessions', () => {
  it('a backend that does not run in a mode is refused before loading', async () => {
    const { _check } = await import('../src/detect');
    const imageOnly = fixtureBackend([], { modes: ['image'] });
    await expect(_check(imageOnly.info, { mode: 'video' })).rejects.toThrow(/does not run in video mode/);
  });
  it('loads once per mode, and release() closes and forgets', async () => {
    const { _session } = await import('../src/detect');
    let loads = 0;
    let closes = 0;
    const b = fixtureBackend([]);
    const counted = { ...b, load: async (ctx: any) => (loads++, { ...(await b.load(ctx)), close: () => void closes++ }) };
    await detect(img, { backend: counted });
    await detect(img, { backend: counted });
    await _session(counted, { mode: 'video' });
    expect(loads).toBe(2);
    await release(counted);
    expect(closes).toBe(2);
    await detect(img, { backend: counted });
    expect(loads).toBe(3);
  });
});

describe('geometry', () => {
  it('pixels and normalised round-trip', () => {
    const r = { schema: 'faces/1' as const, backend: 'x', image: { width: 400, height: 200 }, notes: [], faces: [{ ...face(0.25, 0.5, 0.1, 0.2), keypoints: { leftEye: { x: 0.5, y: 0.5 } } }] };
    const px = toPixels(r);
    expect(px[0].box).toEqual({ x: 100, y: 100, w: 40, h: 40 });
    expect(px[0].keypoints!.leftEye).toEqual({ x: 200, y: 100 });
    expect(fromPixels(px, r.image)[0].box).toEqual(r.faces[0].box);
  });
  it('xyxy converts', () => {
    expect(fromXyxy(toXyxy({ x: 1, y: 2, w: 3, h: 4 }))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
  it('overlap measures', () => {
    expect(overlapOverMin({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBeCloseTo(1);
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBe(0);
  });
  it('merge keeps the best, and a higher-scoring half-face grows to the whole face', () => {
    const full = face(0.1, 0.1, 0.1, 0.1, 0.9);
    const half = face(0.1, 0.1, 0.05, 0.1, 0.97);
    const other = face(0.5, 0.1, 0.1, 0.1, 0.8);
    const m = mergeFaces([full, half, other]);
    expect(m).toHaveLength(2);
    expect(m[0].box).toEqual(full.box);
    expect(m[0].score).toBe(0.97);
  });
  it('tiles cover the image at each level and stay inside it', () => {
    const tiles = planTiles(4032, 3024).slice(1);
    for (const t of tiles) expect(t.x + t.w <= 4032 && t.y + t.h <= 3024 && t.x >= 0 && t.y >= 0).toBe(true);
    for (const side of new Set(tiles.map((t) => t.w))) {
      const lv = tiles.filter((t) => t.w === side);
      expect(Math.max(...lv.map((t) => t.x + t.w))).toBe(4032);
      expect(Math.max(...lv.map((t) => t.y + t.h))).toBe(3024);
    }
    expect(planTiles(500, 400)).toHaveLength(1);
  });
  it('maps a tile face back to the image', () => {
    const f = fromTile({ ...face(0.5, 0.5, 0.25, 0.25), keypoints: { noseTip: { x: 0.5, y: 0.5 } } }, { x: 100, y: 0, w: 200, h: 200 }, { width: 400, height: 200 });
    expect(f.box).toEqual({ x: 0.5, y: 0.5, w: 0.125, h: 0.25 });
    expect(f.keypoints!.noseTip).toEqual({ x: 0.5, y: 0.5 });
  });
  it('roll from the eyes is in degrees, positive clockwise as displayed, in pixel space', () => {
    const r = (dx: number, dy: number) => rollFromEyes({ ...face(0, 0, 1, 1), keypoints: { rightEye: { x: 0.2, y: 0.5 }, leftEye: { x: 0.2 + dx, y: 0.5 + dy } } }, { width: 200, height: 100 });
    expect(r(0.1, 0)).toBe(0);
    expect(r(0.1, 0.2)).toBeCloseTo(45); // 20 px right, 20 px down
    expect(rollFromEyes(face(0, 0, 1, 1), { width: 1, height: 1 })).toBeNull();
  });
});

describe('mediapipe normalisation (pure parts)', () => {
  it('reads yaw/pitch/roll from a column-major matrix', () => {
    const a = (30 * Math.PI) / 180;
    // rotation about Z by +a (canonical y-up frame), column-major
    const m = [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const p = matrixToPose(m);
    expect(p.yaw).toBeCloseTo(0);
    expect(p.pitch).toBeCloseTo(0);
    expect(Math.abs(p.roll)).toBeCloseTo(30);
    expect(matrixToPose([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });
  it('turns 478 points into a box, named keypoints and a tagged mesh', () => {
    const pts = Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + (i % 10) * 0.01, y: 0.2 + Math.floor(i / 50) * 0.01, z: 0 }));
    const f = landmarksToFace(pts);
    expect(f.mesh!.topology).toBe('mediapipe-478');
    expect(f.mesh!.points).toHaveLength(478);
    expect(Object.keys(f.keypoints!).sort()).toEqual(Object.keys(MESH_KEYPOINTS).sort());
    expect(f.box.x).toBeCloseTo(0.3);
    expect(f.box.w).toBeCloseTo(0.09);
    expect(f.score).toBeNull();
  });
});
