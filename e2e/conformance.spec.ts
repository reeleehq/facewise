/**
 * The MediaPipe backends on real photos, in real browsers: conventions (subject's
 * left/right, roll sign, units, declared capabilities) and recall (all 29 faces of the
 * 1927 Solvay photo). Photos are public domain and read from ~/.local/share/faceover/samples
 * (override with FACEWISE_SAMPLES); the test skips without them. No request may leave
 * the page's origin.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SAMPLES = process.env.FACEWISE_SAMPLES ?? join(homedir(), '.local/share/faceover/samples');
const b64 = (f: string) => readFileSync(join(SAMPLES, f)).toString('base64');
const have = (f: string) => existsSync(join(SAMPLES, f));

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (r) => !/^(blob|data):/.test(r.url()) && !r.url().startsWith(origin) && foreign.push(r.url()));
  (page as unknown as { foreign: string[] }).foreign = foreign;
  await page.goto('');
  await page.waitForFunction(() => 'facewise' in window);
});
test.afterEach(async ({ page }) => expect((page as unknown as { foreign: string[] }).foreign).toEqual([]));

test('detector (tiled): Solvay 1927 recall 29/29, conventions hold', async ({ page }) => {
  test.skip(!have('solvay1927.jpg'), 'sample missing');
  const report = await page.evaluate(async (data) => {
    const w = window as any;
    const img = await w.bitmapFromBase64(data);
    const r = await w.facewise.checkBackend(w.facewise.tiled(w.mediapipe.faceDetector()), [{ name: 'solvay', image: img, minFaces: 29, upright: true }]);
    return { ok: r.ok, failures: r.failures, n: r.results.solvay.faces.length };
  }, b64('solvay1927.jpg'));
  console.log('solvay faces:', report.n);
  expect(report.failures).toEqual([]);
  expect(report.n).toBeLessThanOrEqual(31);
});

test('detector and landmarker: one face upright and rotated 15° clockwise', async ({ page }) => {
  test.skip(!have('nasa-crew.jpg'), 'sample missing');
  const out = await page.evaluate(async (data) => {
    const w = window as any;
    const img = await w.bitmapFromBase64(data);
    const found = await w.facewise.detect(img, { backend: w.facewise.tiled(w.mediapipe.faceDetector()) });
    const one = w.crop(img, found.faces[0].box);
    const turned = w.rotate(one, 15);
    const fixtures = [
      { name: 'upright', image: one, minFaces: 1, upright: true, rolledDeg: 0 },
      { name: 'rolled15', image: turned, minFaces: 1, rolledDeg: 15 },
    ];
    const det = await w.facewise.checkBackend(w.mediapipe.faceDetector(), fixtures);
    const lm = await w.facewise.checkBackend(w.mediapipe.faceLandmarker(), fixtures);
    const pose = lm.results.rolled15?.faces[0]?.pose;
    return { det: det.failures, lm: lm.failures, nasa: found.faces.length, pose };
  }, b64('nasa-crew.jpg'));
  console.log('nasa faces:', out.nasa, 'landmarker pose on the 15° fixture:', JSON.stringify(out.pose));
  expect(out.nasa).toBeGreaterThanOrEqual(7); // recall; Chromium adds one score-0.4x false positive (Faceover filters at 0.45)
  expect(out.det).toEqual([]);
  expect(out.lm).toEqual([]);
});
