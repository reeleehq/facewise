# A browser face facade for pictures and video: synthesis and design

**Recommendation.** Build one small TypeScript package (now **facewise**), browser-only for now, that owns *faces in media*: `detect(image)` for stills and `track(source)` for video files (a live camera later), one Zod schema for the results, and backends loaded only when used. Its v1 has a single dependency, MediaPipe tasks-vision (already in Faceover), covering both the face detector and the 478-point face landmarker. Video adds Mediabunny (MPL-2.0, ~190 kB) in its own subpath. Faceover becomes its first consumer, and reelee's video work its second. The three reports behind this are `01-browser-face-libraries.md` (what exists), `02-browser-video-face-pipeline.md` (video) and `03-face-facade-interface.md` (the interface). Each has its own numbered references.

## What exists, in one paragraph each

**Browser libraries (01).** MediaPipe tasks-vision is the only actively released face library: version 1.2.3 shipped on 2026-11-11, and both code and weights are Apache-2.0. The TF.js family (tfjs, face-api.js forks, ml5, MindAR, Human's models) has been frozen since late 2024. WebGPU-era runtimes (onnxruntime-web, LiteRT.js, transformers.js) return tensors, not faces, so each model needs its own decoding. The best second backend is YuNet on onnxruntime-web: MIT code and weights, 232 KB. The licence traps are in the weights: SCRFD and InsightFace weights are non-commercial, and YOLO-face weights are GPL or AGPL. The Chromium Shape Detection API still sits behind a flag. No library gives persistent track ids.

**Video (02).** In the browser, Mediabunny replaces mp4-muxer and webm-muxer, which are now deprecated. It decodes with WebCodecs, gives a per-frame `process` hook for drawing covers, and copies audio without decoding it, which matters on iOS. ffmpeg.wasm is out: GPL, 32 MB, and 0.04x to 0.08x native speed. A file takes two passes in one worker: (1) detect at about 640 px and track; (2) decode again, draw covers from the tracks, encode MP4 with H.264. Tracking is a small IoU, Kalman and ByteTrack-style module of our own, ported from Roboflow's Apache-2.0 code, since no maintained JS tracker exists. What keeps faces covered is the *covering policy* (low threshold, margin, a hold time, lookahead, never shrinking a cover to smooth it). Cloud video APIs already return either tracks (Google) or timestamped boxes (AWS), and both fit one `FacesOverTime` shape. From `burns/ts` we reuse its feature checks and its split between pure planning code and the browser encoder, but not its encoder loop or muxer.

**Interface (03).** Every face API returns the same core: a box, a score, named points, often yaw, pitch and roll. Each uses different units, and MediaPipe even mixes pixels and ratios in one result. "Left eye" is the main trap: Google and Azure use the viewer's side, MediaPipe and COCO the subject's. The fleet already has four `Face` types that disagree: burns, cutan and lookbook in Python, plus Faceover. The design follows the maintainer's facade doctrine (`facade-design`; ocracy and arioso as patterns): one path every call goes through, capabilities declared as data, an error when a wanted output is missing, and three escape hatches.

## The design (decisions taken; the four that are yours are at the end)

**Verbs.** `detect(image, {backend, want, minScore, maxFaces, native, signal})` returns a `FaceResult`. `track(source, {pacing, tracker, …})` yields `FaceFrame`s, and `toTracks(frames)` gives `FacesOverTime`. Pure helpers: `toPixels`, `toXyxy`, `compare` (later, for embeddings), and `find(query)` over the capability ledger.

**Schema (Zod, the SSOT; JSON Schema exported for the Python side).**
- Coordinates are **normalised [0, 1]**, top-left origin, `{x, y, w, h}`, with `image: {width, height}` carried alongside (reports 01 and 02 recommend this; 03 recommended pixels). Video detects at one resolution and renders at another, and tiles at a third, so ratios are the only unit that survives. Pixels are one call away (`toPixels`). Boxes are not clamped: a partial face outside the frame must still be covered inside it.
- Scores are in [0, 1], or `null` when a backend gives none. Angles are in degrees.
- Left and right are the **subject's own** (MediaPipe and COCO). Adapters for viewer-frame APIs swap them, and a fixture test pins this per backend.
- Named keypoints: `rightEye, leftEye, noseTip, mouthCenter, mouthRight, mouthLeft, rightEar, leftEar`. Dense meshes are carried as `{topology, points}`.
- Optional slots: `mesh`, `pose`, `blendshapes`, `quality`, `embedding`, `trackId`, `extras`. The native result is attached as a non-enumerable `raw`.
- Time is in seconds of media time.
- Demographic attributes (age, gender, emotion) are never canonical; they are reachable only through `raw`.

**Capabilities as data.** Each backend declares what it actually fills, per mode: keypoint names, mesh topology, pose, tracks, score. It also declares privacy (whether the image leaves the device, and which third-party hosts it contacts), licences (code and weights separately), and cost (unknown stays `null`, never 0). Asking for an output the chosen backend does not produce raises an error that names the backends that do. A backend whose image leaves the device refuses to run unless the caller passes `allowRemote: true`.

**Lightweight by construction.** The core depends only on Zod. Each backend is a subpath export (`/mediapipe`, later `/yunet`, `/shape-detection`, `/cloud`). Its library is an optional peer dependency, loaded by `import()` on the first call. Video lives in `/video`, the only place Mediabunny is imported. An app that only detects faces in photos never downloads the video code.

**Seams (five, each one keyword).**

| Seam | v1 default (no new dependency) | Replacement in view |
|---|---|---|
| `backend` | MediaPipe face detector, full-range, self-hosted | MediaPipe landmarker (v1 too); YuNet on onnxruntime-web; a cloud proxy |
| `tiling` | `tiled()`: Faceover's three-scale scan and merge | none (live video, for latency) |
| `tracker` | greedy IoU with a time-to-live | ByteTrack-style module; a backend's own tracks |
| `executor` | inline, yielding between tiles | a module worker (an in-house webcam app's hands worker) |
| `assets` | same-origin resolver | a CDN or another host (an in-house webcam app's resolver) |

NOT seams: the cover-drawing (that is the consumer's, as Faceover's transforms are), NMS thresholds, and the video codec choice (MP4/H.264 is the one that plays everywhere).

**Cloud later, same interface.** A `/cloud` backend posts to *our own* server (our own server), which holds the vendor keys and returns a `FaceResult` or `FacesOverTime` already validated against the same JSON Schema. The browser never holds a vendor key.

**v1 scope** (one-command test: the Solvay photo's 29 of 29 faces as a regression test, plus a 10-second public-domain clip with every face covered in every frame):
1. Core: schema, geometry (normalise, xywh/xyxy, NMS merge, tiling), `detect`, capability check, fixture backend, conformance kit (`checkBackend`).
2. `/mediapipe`: detector and landmarker, with fixtures pinning left/right and roll sign.
3. `/video`: `track` over a file (Mediabunny, two passes, IoU tracker, covering policy), MP4 out with audio copied.
4. Faceover moves onto it (thorwhalen/faceover#2), then gains video.

Later, each one an addition at an existing seam: YuNet, Shape Detection, a worker executor, live camera (`MediaStreamTrackProcessor`), embeddings (SFace, MIT), cloud.

## Decisions taken (2026-11-25)

1. Name: **facewise** (free on npm and PyPI).
2. Home: **reeleehq** (beside burns and the AV substrate).
3. Published to npm at v1.
4. Conventions as above: the subject's own left/right, normalised coordinates with the image size carried alongside, no demographic attributes in the common schema.
