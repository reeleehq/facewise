# facewise

Faces in pictures and video, in the browser, behind one interface.

```ts
import { detect } from 'facewise';

const result = await detect(imageBitmap);  // every face: box, score, eyes, nose, mouth, ears
for (const face of result.faces) console.log(face.box, face.score, face.keypoints?.leftEye);
```

Nothing leaves the device: the default backend (MediaPipe's full-range face detector, scanned in tiles so small faces in group photos are found) runs as WebAssembly, loads only when first used, and fetches its runtime and model from your app's own origin. Put them there once:

```bash
npm install facewise @mediapipe/tasks-vision
npx facewise-assets public            # wasm runtime + the detector model, checksummed
npx facewise-assets public face_landmarker.task   # add the 478-point landmarker
```

## One result shape for every backend

`detect` returns a `faces/1` `FaceResult` (a Zod schema; JSON Schema in `schemas/` for other languages):

- boxes `{x, y, w, h}` **normalised** to the image (top-left origin, not clamped), with the image size alongside: `toPixels(result)` gives pixels;
- `score` in [0, 1], or `null` when a backend gives none;
- named `keypoints` (`rightEye`, `leftEye`, `noseTip`, `mouthCenter`, `mouthRight`, `mouthLeft`, `rightEar`, `leftEar`) using the **subject's own** left and right;
- optional `mesh` (with its topology, e.g. `mediapipe-478`), `pose` (yaw, pitch, roll in degrees; roll > 0 is clockwise as displayed), `blendshapes`, `trackId`;
- `notes` for anything the call changed (filters, dropped faces), and the backend's native output as a non-enumerable `raw`.

## Backends

| Backend | Import | Gives |
|---|---|---|
| MediaPipe face detector (default, tiled) | `facewise/mediapipe` → `faceDetector()` | box, score, 6 keypoints |
| MediaPipe face landmarker | `facewise/mediapipe` → `faceLandmarker()` | box, 8 keypoints, 478-point mesh, pose, 52 blendshapes |

```ts
import { detect, tiled } from 'facewise';
import { faceLandmarker } from 'facewise/mediapipe';

const r = await detect(canvas, { backend: faceLandmarker(), want: ['pose', 'mesh'] });
```

Each backend declares what it really gives (`backend.info`): asking for something it cannot give (`want: ['mesh']` from the detector) raises an error that names a backend that can. A backend that would send the image off the device refuses to run unless you pass `allowRemote: true`. `tiled(backend)` wraps any backend to scan large images in tiles; `checkBackend(backend, fixtures)` tests a backend's conventions on your own images.

## Roadmap

Video files (`track`: detect, track and cover every face in every frame, two passes with Mediabunny), a live camera, more backends (YuNet on onnxruntime-web, the browser Shape Detection API), a worker executor, embeddings, and cloud APIs reached through your own server. The design and the research behind it: `docs/research/face-facade-synthesis.md` and `docs/adr/`.

## Develop

```bash
npm install
npm test              # unit tests (schema, geometry, the detect path)
npm run test:e2e      # MediaPipe conformance in WebKit and Chromium on public-domain photos
npm run build && npm run schema
```

The e2e reads its photos from `~/.local/share/faceover/samples/` (`FACEWISE_SAMPLES` to override) and skips without them; photos of people are never committed.

## Licence

MIT. MediaPipe and its models are Apache-2.0.
