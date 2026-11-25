#!/usr/bin/env node
// facewise-assets <public dir> [model ...]
//
// Puts what the MediaPipe backends load into an app's public folder, so they are served
// from the app's own origin (no CDN): the wasm runtime, copied from the app's
// @mediapipe/tasks-vision, into <dir>/mediapipe/, and the models, downloaded and checked
// against their sha256 (table: assets/models.json, the same one the adapter reads), into
// <dir>/models/. Models already present with the right hash are kept.
// Default model: blaze_face_full_range.tflite.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models.json'), 'utf8')).mediapipe;

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
    console.error(`facewise-assets: unknown model ${name} (known: ${Object.keys(MODELS).join(', ')})`);
    process.exit(2);
  }
  const out = join(dir, 'models', name);
  if (existsSync(out) && sha(readFileSync(out)) === spec.sha256) continue;
  const res = await fetch(spec.url);
  if (!res.ok) throw new Error(`facewise-assets: ${spec.url} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== spec.sha256) throw new Error(`facewise-assets: ${name} checksum mismatch`);
  writeFileSync(out, buf);
}
console.log(`facewise-assets: runtime + ${models.join(', ')} in ${resolve(dir)}`);
