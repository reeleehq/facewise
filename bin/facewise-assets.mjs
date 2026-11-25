#!/usr/bin/env node
// facewise-assets <public dir> [model ...]
//
// Puts what the MediaPipe backends load into an app's public folder, so they are served
// from the app's own origin (no CDN): the wasm runtime, copied from the app's
// @mediapipe/tasks-vision, into <dir>/mediapipe/, and the models, downloaded and checked
// against their sha256, into <dir>/models/. Models already present with the right hash
// are kept. Default models: blaze_face_full_range.tflite.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MODELS = {
  'blaze_face_full_range.tflite': ['https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite', '3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b'],
  'blaze_face_short_range.tflite': ['https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite', 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f'],
  'face_landmarker.task': ['https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'],
};

const [dir, ...wanted] = process.argv.slice(2);
if (!dir) {
  console.error('usage: facewise-assets <public dir> [model ...]\nmodels: ' + Object.keys(MODELS).join(', '));
  process.exit(2);
}
const models = wanted.length ? wanted : ['blaze_face_full_range.tflite'];
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const pkg = resolve('node_modules/@mediapipe/tasks-vision/wasm');
if (!existsSync(pkg)) {
  console.error(`facewise-assets: ${pkg} not found; install @mediapipe/tasks-vision in this app first.`);
  process.exit(1);
}
mkdirSync(join(dir, 'mediapipe'), { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) copyFileSync(join(pkg, f), join(dir, 'mediapipe', f));

mkdirSync(join(dir, 'models'), { recursive: true });
for (const name of models) {
  const spec = MODELS[name];
  if (!spec) {
    console.error(`facewise-assets: unknown model ${name}`);
    process.exit(2);
  }
  const [url, hash] = spec;
  const out = join(dir, 'models', name);
  if (existsSync(out) && sha(readFileSync(out)) === hash) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`facewise-assets: ${url} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== hash) throw new Error(`facewise-assets: ${name} checksum mismatch`);
  writeFileSync(out, buf);
}
console.log(`facewise-assets: runtime + ${models.join(', ')} in ${resolve(dir)}`);
