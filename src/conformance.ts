/**
 * `checkBackend`: does a backend keep the facade's conventions on real images? Run it
 * on openly licensed fixtures; it is what pins each adapter's left/right, units and
 * declared capabilities (the TS form of ocracy's `validate_adapter`).
 */
import type { AssetResolver, FaceBackend, ImageInput } from './backend';
import { detect } from './detect';
import { rollFromEyes } from './geometry';
import type { DetectedFace, FaceResult } from './schema';
import { FaceResult as FaceResultSchema } from './schema';

export interface Fixture {
  name: string;
  image: ImageInput;
  /** At least this many faces must be found. */
  minFaces?: number;
  /** Faces are upright, frontal and unmirrored: the subject's left eye is on the image's right. */
  upright?: boolean;
  /** The image was rotated by this many degrees clockwise: roll must agree (±tolerance). */
  rolledDeg?: number;
}

export interface ConformanceReport {
  ok: boolean;
  failures: string[];
  results: Record<string, FaceResult>;
}

export async function checkBackend(
  backend: FaceBackend,
  fixtures: Fixture[],
  { assets, rollTolerance = 8 }: { assets?: AssetResolver; rollTolerance?: number } = {},
): Promise<ConformanceReport> {
  const failures: string[] = [];
  const results: Record<string, FaceResult> = {};
  const { emits } = backend.info;
  const fail = (fx: Fixture, msg: string) => failures.push(`${fx.name}: ${msg}`);
  for (const fx of fixtures) {
    const r = await detect(fx.image, { backend, assets });
    results[fx.name] = r;
    const parsed = FaceResultSchema.safeParse(r);
    if (!parsed.success) fail(fx, `result is not a valid faces/1 FaceResult: ${parsed.error.message}`);
    if (fx.minFaces !== undefined && r.faces.length < fx.minFaces) fail(fx, `found ${r.faces.length} faces, expected at least ${fx.minFaces}`);
    r.faces.forEach((f: DetectedFace, i) => {
      const at = `face ${i}`;
      if (emits.score && f.score === null) fail(fx, `${at}: declares a score but gave none`);
      if (!emits.score && f.score !== null) fail(fx, `${at}: gave a score it does not declare`);
      const { x, y, w, h } = f.box;
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || w > 1.5 || h > 1.5) fail(fx, `${at}: box is not normalised (${JSON.stringify(f.box)})`);
      for (const k of emits.keypoints) if (!f.keypoints?.[k]) fail(fx, `${at}: declares keypoint ${k} but gave none`);
      if (emits.mesh && f.mesh?.topology !== emits.mesh) fail(fx, `${at}: declares mesh ${emits.mesh}, gave ${f.mesh?.topology ?? 'none'}`);
      if (emits.pose && !f.pose) fail(fx, `${at}: declares pose but gave none`);
      if (fx.upright && f.keypoints?.leftEye && f.keypoints?.rightEye && !(f.keypoints.leftEye.x > f.keypoints.rightEye.x))
        fail(fx, `${at}: leftEye is not on the image's right (left/right must be the subject's)`);
      if (fx.rolledDeg !== undefined) {
        const eyes = rollFromEyes(f, r.image);
        if (eyes !== null && Math.abs(eyes - fx.rolledDeg) > rollTolerance) fail(fx, `${at}: eye roll ${eyes.toFixed(1)}°, expected ${fx.rolledDeg}°`);
        if (f.pose && Math.abs(f.pose.roll - fx.rolledDeg) > rollTolerance) fail(fx, `${at}: pose.roll ${f.pose.roll.toFixed(1)}°, expected ${fx.rolledDeg}°`);
      }
    });
  }
  return { ok: failures.length === 0, failures, results };
}
