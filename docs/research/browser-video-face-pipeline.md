# The browser video pipeline for face de-identification, and how existing tools do it

Research for the "faces in pictures and videos" TypeScript facade, second consumer after Faceover's photo mode [1]: anonymise every face in a video file entirely in the browser, and later a live camera feed. Researched 2026-11-25; every library version, licence and size below was read from npm, bundlephobia or GitHub on that date.

## Summary and recommendation

- **Use Mediabunny for all container and codec work** (demux, decode, encode, mux, audio copy) [10][11]. It is MPL-2.0, zero-dependency TypeScript over WebCodecs, actively released (1.66.4, published the day before this report), and it is the declared successor of `mp4-muxer` and `webm-muxer`, both now deprecated on npm with the message "superseded by Mediabunny" [18][19]. Do not use ffmpeg.wasm for v1: its core is GPL-2.0-or-later, a 32 MB wasm, and its own benchmark measures it at 0.04x (single thread) to 0.08x (multi thread) of native FFmpeg speed [21][22][24].
- **Process a file in two passes, not one.** Pass 1 decodes downscaled frames, detects faces and builds tracks (a few kilobytes of JSON). Pass 2 decodes again, draws covers from the tracks, re-encodes video and copies audio untouched. Offline processing is allowed to look ahead, so a face can be covered a few frames *before* its first detection and gaps can be filled by interpolation between both ends. No published tool documents doing this; it is the main lever a file pipeline has over a live one.
- **Tracking is cheap; the policy around it is what keeps faces covered.** A SORT-style IoU tracker with ByteTrack's second pass over low-score detections [35][36] is a few hundred lines; there is no maintained JavaScript implementation on npm, so write it, using Roboflow's Apache-2.0 clean-room `trackers` as the reference (not the GPL-3.0 original SORT) [38]. The rules that matter are recall-first: cover tentative tracks, hold a lost track's box (growing) for a bounded time, dilate boxes, and never let jitter smoothing shrink coverage.
- **Output MP4 with H.264 by default, keep the input's audio by copying its packets.** H.264 is the most compatible codec for files people save and share [6]; VP9 in WebM "lacks native playback support on macOS and iOS" [6]. Copying audio needs no `AudioDecoder`, which iOS Safari only gained in 26 [4][5].
- **Faces over time are a list of tracks, each a time-sorted list of boxes in normalised coordinates with a provenance tag** (`detected`, `predicted`, `interpolated`, `held`, `manual`). Google Video Intelligence already returns this shape [49]; Rekognition returns flat timestamped detections without track ids [48]; both map onto it (schema below).
- **burns/ts gives a pattern, not a pipeline.** Reuse its feature check, its "pure plan plus browser-only encode" split and its `onChunk` seam. Do not reuse its muxer (depends on the deprecated `webm-muxer`), its encode loop (no backpressure, fine for a short Ken Burns clip but not for re-encoding a long video), or its VP9/WebM default.

## Standard terminology

- **De-identification / anonymisation / redaction**: removing identity information from faces; "redaction" is the term in video products (Azure, Sighthound, brighter AI) [50][45].
- **Demux / mux**: reading encoded packets out of a container (MP4, WebM) and writing them into one. **Transcode**: decode then re-encode. **Transmux / copy / passthrough**: move packets between containers without decoding [12].
- **Tracking-by-detection**: run a detector, associate detections across frames into tracks. **Multi-object tracking (MOT)**: the research field (SORT, ByteTrack, OC-SORT) [35][36][37].
- **Hold / coast**: keep a track alive and drawn for some frames after its detections stop. **Dilation / margin**: enlarging a box beyond the detection (`deface` calls it `--mask-scale`, default 1.3) [43].
- **Frame-level miss rate**: the share of (frame, visible face) pairs in which the face is not covered; the complement of per-frame anonymisation recall [53].

## (a) Decoding, encoding, demuxing and muxing in the browser

### Libraries

| Library | Version, licence | Size | Role | Verdict |
|---|---|---|---|---|
| Mediabunny [10][11] | 1.66.4, MPL-2.0 | 764 kB min / 193 kB gzip for everything (bundlephobia [17]); "as small as 5 kB gzipped" tree-shaken [10] | Read/write MP4, MOV, WebM, MKV, MP3, WAV, Ogg, AAC, FLAC, TS, HLS; Conversion API; decode via WebCodecs [11] | **depend** |
| `@mediabunny/aac-encoder` [15] | 1.66.4, MPL-2.0 | wasm build of FFmpeg's AAC encoder, runs in its own worker | AAC encoding where WebCodecs lacks it (Firefox has no AAC [6]) | depend only if audio must be transcoded |
| `@mediabunny/server` [16] | 1.66.4, MPL-2.0 | wraps NodeAV / FFmpeg C API | Same Mediabunny API in Node, Bun, Deno | candidate for the cloud backend |
| mp4box.js [20] | 2.6.0, BSD-3-Clause | 206 kB min / 47 kB gzip | MP4 parsing and segmenting; you write the WebCodecs loop and the muxing yourself | avoid (Mediabunny covers it) |
| `mp4-muxer`, `webm-muxer` [18][19] | 5.2.2 / 5.1.4, MIT | ~150 kB unpacked each | Muxers only | **deprecated**, "superseded by Mediabunny" |
| ffmpeg.wasm [21][22] | `@ffmpeg/ffmpeg` 0.12.15 MIT; `@ffmpeg/core` 0.12.10 **GPL-2.0-or-later** | `ffmpeg-core.wasm` 32.2 MB | Full FFmpeg in wasm | avoid: 0.04x / 0.08x native speed [24], 2 GB input ceiling reported [23], multi-thread build needs `SharedArrayBuffer` and so cross-origin isolation, last npm release April 2025 |

Why Mediabunny fits this job:

- Its Conversion API takes a per-frame `process(sample)` callback that may return a canvas, a `VideoSample`, an array, or `null`; output size is declared with `processedWidth`/`processedHeight` [12]. That callback is exactly where covers are drawn.
- Tracks are copied, not transcoded, whenever nothing forces a transcode; `copy.mode` defaults to `'preferred'`, and `discardedTracks` / `isValid` report what could not be carried over [12]. So an MP4 with AAC audio goes to an MP4 with the same AAC packets, and no audio codec is touched.
- `CanvasSink` decodes and scales frames to a given width/height with a fixed canvas pool, and falls back to `OffscreenCanvas` in workers [13]. That is the detection pass's input, already downscaled.
- `StreamTarget` writes to a `FileSystemWritableFileStream`, so long outputs need not live in memory; MP4 `fastStart: false` "uses the least memory", `'in-memory'` keeps every chunk until finalisation, `'fragmented'` stays light at any length but is less widely supported [14].
- Progress (`onProgress`), cancel and pause are built in [12].

### Browser support (from caniuse unless stated)

| API | Chrome/Edge | Firefox | Safari macOS | Safari iOS |
|---|---|---|---|---|
| `VideoDecoder` / `VideoEncoder` [2][3] | 94+ | 130+ desktop; Android none | 16.4+ | 16.4+ |
| `AudioDecoder` / `AudioEncoder` [4][5] | yes | yes | 26+ | 26+ |
| `OffscreenCanvas` (with WebGL) [25][26] | yes | yes | 17+ (16.4 to 16.6: 2D only; WebGL in workers needs macOS Sonoma / iOS 17) | 17+ |
| `requestVideoFrameCallback` [29][30] | 83+ | 132+ | 15.4+ | 15.4+ |
| `MediaStreamTrackProcessor` / `VideoTrackGenerator` [31][33] | 94+, "partial" (Chrome ships the older window-exposed shape) | not yet; Mozilla posted an intent to prototype in 2026 | 18+, dedicated worker only | 18+, dedicated worker only |

Consequences: the file pipeline runs on iOS 16.4+ for video, but audio must be copied, not transcoded, on iOS before 26. Run the encoder through `VideoEncoder.isConfigSupported()` with a descending list of `avc1` codec strings, as MDN recommends [6].

### Memory, speed and backpressure

- Decoded frames hold scarce resources. The spec: "Authors are encouraged to call close() on output VideoFrames immediately ... failing to release them (or waiting for garbage collection) can cause decoding to stall"; codec resources "MAY be quickly exhausted" [7]. Never buffer many `VideoFrame`s for look-ahead; keep tracks (small) rather than frames (large). This is the main reason for two passes over a single pass with a frame buffer.
- Backpressure: when a codec is saturated, further `decode()` / `encode()` calls queue and raise `decodeQueueSize` / `encodeQueueSize`; the `dequeue` event tells you when to feed more [7][9]. Mediabunny's pipeline applies "automatic backpressure" [11]; a hand-written loop (like burns') must check the queue size itself.
- Speed: hardware WebCodecs decode/encode is far faster than ffmpeg.wasm's software path (ffmpeg.wasm's own figure: a 5.2 s native transcode takes 60.4 s multi-threaded and 128.8 s single-threaded [24]). No published benchmark measures a decode, detect, draw, encode loop with MediaPipe in a browser, so the v1 harness should log milliseconds per stage per frame; detection (especially tiled detection) is expected to dominate.

### Workers and OffscreenCanvas

- MediaPipe's `detect()` and `detectForVideo()` are synchronous and block the thread, and Google recommends running them in a web worker [27]. The tasks-vision typings accept `TexImageSource`, which includes `VideoFrame`, `ImageBitmap` and `OffscreenCanvas`, and the runner accepts an `OffscreenCanvas` for its WebGL2 context (read from `vision.d.ts` in 1.2.3) [28]. The package's wasm is 14.7 MB.
- `VideoFrame` is transferable to dedicated workers and can be constructed from an `OffscreenCanvas` or `ImageBitmap` [8].
- Mediabunny itself has no worker requirement; it runs where WebCodecs runs, and its optional codec extensions start their own workers from `blob:` URLs (a CSP must allow that or host the worker file, plus `'wasm-unsafe-eval'`) [14][15].

### `requestVideoFrameCallback` is for preview, not for export

rVFC is "best effort, and the browser doesn't offer any strict guarantees" of a callback per frame [29]. A tool that plays the video and records the canvas (the approach of the one browser project found, Faceveil, which uses MediaRecorder [51]) is bound to real time and can drop frames. Use rVFC only to draw the track overlay on a playing `<video>` during review, keyed on `metadata.mediaTime`, and use WebCodecs decode for the export, where every frame is visited exactly once.

### The later live feed

- Preferred path: `getUserMedia` track → transfer to a dedicated worker → `MediaStreamTrackProcessor` yields `VideoFrame`s → detect + track + draw → `VideoTrackGenerator` → display, `MediaRecorder`, or WebRTC [32][34]. Safari 18+ supports this in dedicated workers only; Chrome has its own variant; Firefox does not yet [31][33].
- Fallback for every browser: `<video>` + rVFC + canvas + `canvas.captureStream()`.
- Live tracking is causal: no look-ahead, so no pre-roll covering. Margin and hold carry all the safety. MediaPipe's `LIVE_STREAM` mode "automatically drops incoming frames when busy" [42]; a dropped detection must fall back to the tracker's prediction, never to an uncovered face.

## (b) Face tracking across frames

### Methods

| Method | Idea | Relevance |
|---|---|---|
| IoU tracker | Match each detection to the track whose last box overlaps it most | Baseline; enough for few, slow faces |
| SORT [35] | Kalman filter (constant velocity) predicts each track; Hungarian matching on IoU | Gives predicted boxes for frames without detections. Original code GPL-3.0; the paper is the reference |
| ByteTrack [36] | Second association pass that matches leftover tracks to **low-score** detections; "many occluded objects can be correctly detected but have low scores" | The recall-first idea: a weak detection near a live track extends the track instead of being dropped |
| OC-SORT [37] | Re-estimates the Kalman state from virtual observations after a track is re-found (ORU) and re-associates on last observations (OCR) | Helps when a face is lost for longer and moves non-linearly |
| Kalman filter | State estimator under SORT | `kalman-filter` on npm (2.3.0, MIT, last published 2023) [41], or ~50 lines for a 4D constant-velocity box |
| One Euro filter [39] | Low-pass filter whose cutoff rises with speed: less jitter at rest, less lag in motion; tune `min_cutoff` first, then `beta` | Smooths cover jitter. `1eurofilter` on npm is the authors' TypeScript version (1.3.0, BSD-3-Clause) [40] |
| MediaPipe Face Landmarker, VIDEO mode [42] | "Synchronous tracking across decoded video frames", `min_tracking_confidence`, temporal smoothing only with `numFaces = 1` | Not a multi-face tracker for this job; useful later for per-face landmarks |

No maintained JavaScript SORT, ByteTrack or OC-SORT exists on npm (searched `bytetrack`, `sort tracker`, `multi object tracking`, `object tracker iou`); the Python `trackers` from Roboflow is Apache-2.0 with clean-room SORT, ByteTrack and OC-SORT [38] and is the reference to port from.

### The covering policy: a face is never uncovered for a frame

The tracker decides identity; the **covering policy** decides what gets drawn, and it should be a separate, swappable function over tracks. Recommended defaults (starting points to tune on test videos, not sourced values):

1. **Detection cadence.** Full-frame detection every frame if the budget allows, otherwise every N frames with tracker predictions in between. A tiled multi-scale scan (Faceover's photo method [1]) on a slower cadence, for example once a second and at every detected scene cut, finds new small faces; between scans, tracks carry them.
2. **Low threshold, confirmed later.** Use a low detection threshold (`deface` defaults to 0.2 for this reason [43]) and ByteTrack's second pass. Cover tentative tracks immediately; confirmation only decides whether a track gets a stable id.
3. **Margin.** Dilate each box (1.3x in `deface` [43]), more for profile and tilted faces, and grow it with speed.
4. **Hold.** When detections stop, keep drawing the Kalman-predicted box for up to H seconds (start near 0.5 s), growing it with each frame of uncertainty, then drop. Holding across a scene cut covers a non-face region briefly; that is a false positive, which is cheap.
5. **Offline only: pre-roll and interpolation.** Extend each track backwards by a few frames before its first detection (faces enter frames partially and are detected late), and fill gaps between observations by interpolating between both ends instead of extrapolating from one.
6. **Smoothing never shrinks coverage.** A One Euro filter trades jitter for lag, and lag on a moving face is an uncovered edge. Draw the union of the smoothed box and the latest raw box, or smooth the centre and take the larger size.

## (c) Existing face-redaction tools and what they output

| Tool | How it works | Output |
|---|---|---|
| ORB-HD `deface` [43][44] | Python CLI; CenterFace ONNX detector (7.3 MB in the repo) run on every frame independently, no tracking; ellipse masks scaled 1.3x; blur, solid, mosaic or image; audio dropped unless `--keep-audio`; MIT; last push October 2024 | Anonymised video only |
| brighter AI [45] | Commercial (Milestone Systems since 2025); "Precision Blur" and "Deep Natural Anonymization", which replaces faces and plates with synthetic ones; web portal and REST API | Redacted media; box metadata reportedly from a separate analytics endpoint (not verified in the API docs) |
| YouTube Studio "Blur faces" [46] | Server-side: scans the upload, groups appearances by person, the creator picks which faces to blur, boxes can be moved, resized, shape changed | Re-processed video; the per-person grouping is exposed only in the UI |
| Signal blur [47] | Photos only, on device, using platform face detection; the post says it does not "detect every face 100% of the time", so a manual blur brush was added | Edited image |
| Amazon Rekognition Video `GetFaceDetection` [48] | Async job on S3 video | Flat list `Faces[]` of `{Timestamp (ms), Face: {BoundingBox {Left, Top, Width, Height} as ratios, Confidence, Landmarks, Pose, ...}}`, sorted by time, paginated, with `VideoMetadata` (fps, size). **No track id**; "Timestamp is not guaranteed to be accurate to the individual frame where the face first appears" |
| Google Video Intelligence `FACE_DETECTION` [49] | Async job | `faceDetectionAnnotations[].tracks[]`, each `{segment {startTimeOffset, endTimeOffset}, timestampedObjects[] {normalizedBoundingBox {left, top, right, bottom} in [0,1], timeOffset, attributes, landmarks}, confidence}` plus a base64 `thumbnail`. **Tracks, already** |
| Azure AI Video Indexer redaction [50] | Index the video first (billable), then `POST .../redact` with `blurringKind` (MediumBlur, HighBlur, LowBlur, BoundingBox, Black) and an include/exclude `filter.ids` over face ids | New MP4. Insights give `faces[] {id, confidence, thumbnails[].instances[] {start, end}}`; per-frame boxes only in the `faces.json` artifact. FAQ: faces are missed depending on "face angle, the number of frames the face is present, and the quality of the source video" |
| Faceveil [51] | Browser, MediaPipe BlazeFace, blur/pixelate/cover, manual areas; video is processed during playback and recorded with MediaRecorder | WebM or MP4 by browser support. No licence, created September 2026, 0 stars: prior art, not a dependency |

What the industry agrees on: detect, group into persons or tracks, let a human choose or correct, then render. What a future cloud backend would return is one of two shapes: tracks with per-frame boxes (Google) or flat timestamped detections (Rekognition, `deface` if it were instrumented). The schema below holds both.

## (d) Best practice and evaluation

- **Recall over precision.** A false positive costs an extra cover; a false negative leaks an identity. The Street View system tuned a sliding-window detector to "a high recall, low-precision operating point" plus false-positive removal and reports blurring over 89% of faces [52]; the smart-intersection pipeline sets a low threshold and reports over 99% of identifiable faces blurred [53]; operating-room work states that recall "is more important than [precision] in order not to miss a person" [56] and counts a face as handled only if covered in every view where it is visible [55].
- **Define "missed" per frame and per size.** Angus et al. count an object as missed when more than half of it stays unblurred, and only score faces large enough to identify (over 250 pixels) [53]. Report recall by face size, as WIDER FACE does with easy/medium/hard subsets dominated by small, occluded and posed faces [58].
- **Metrics for this facade** (proposed, combining the above): (1) frame-level miss rate over (frame, ground-truth face) pairs, a face being covered when at least 90% of its box lies under the cover; (2) exposure events: maximal runs of consecutive uncovered frames per face, with the count per minute and the longest run in milliseconds (a single uncovered frame is a leak when someone scrubs frame by frame); (3) cover overreach: covered area outside faces, as the precision cost; all three split by face size and pose.
- **Temporal consistency** is measured only by proxies (identity similarity across frames) in the anonymisation literature, which notes "no method measuring the temporal consistency in a way that humans perceive it" [57]. For opaque covers, consistency reduces to jitter and id switches (the animal changing between frames), both measurable from tracks.
- **Known failure cases**: small and distant faces (the reason Faceover tiles [1]), profile and tilted faces, occlusion by bodies, objects and branches [53], motion blur, low light, faces entering at frame edges, scene cuts, reflections and faces on screens, and detector bias across demographics, which Signal cites as its reason for a manual brush [47]. Blur and mosaic can be reversed by recognition models [59]; Faceover's opaque animal cover avoids that.
- **A review step is standard**: YouTube, Azure and Signal all let a person add or remove faces [46][50][47]. The track list is the natural thing to review and edit.

## Recommended v1 browser pipeline

### Dependencies, in the order they are needed

| Order | Package | Licence | Size | Purpose |
|---|---|---|---|---|
| 1 | `@mediapipe/tasks-vision` 1.2.3 [28] | Apache-2.0 | 156 kB JS + 14.7 MB wasm + model | Detector, already used by Faceover |
| 2 | `mediabunny` 1.66.4 [10] | MPL-2.0 | 193 kB gzip whole, less tree-shaken [17] | Demux, decode (`CanvasSink`), Conversion with `process`, MP4/WebM output, audio copy |
| 3 | own tracker module | ours | a few kB | IoU + Kalman + ByteTrack-style second pass; port from Roboflow `trackers` (Apache-2.0) [38] |
| 4 | `1eurofilter` 1.3.0 [40] | BSD-3-Clause | 38 kB unpacked | Cover jitter (render-time only) |
| later | `@mediabunny/aac-encoder` [15] | MPL-2.0 | wasm | Only if audio must be transcoded on a browser without AAC encoding |

MPL-2.0 is file-level copyleft: using Mediabunny unmodified in a closed or MIT app is fine; modified Mediabunny files must be published [10].

### Flow

1. **Probe** (worker): `Input` over the `File`; read duration, size, fps, rotation, track codecs; pick output container (keep the input's when possible so audio copies), pick the first `avc1` string `isConfigSupported` accepts [6].
2. **Pass 1, detect and track** (worker): iterate a `CanvasSink` at detection resolution (for example 640 px wide); per frame run full-frame detection, and the tiled scan on its cadence; feed detections with their timestamps to the tracker; close or recycle every frame. Output: `FacesOverTime` (below). Progress is reported per frame.
3. **Review** (main thread, optional in v1): play the original `<video>`, draw track boxes with rVFC on `mediaTime`; the user can add, delete or nudge a track (`source: 'manual'`).
4. **Pass 2, render and encode** (worker): `Conversion.init` with `video.process(sample)` that draws the frame and the covers for `sample.timestamp` (from the policy function over tracks) onto an `OffscreenCanvas` and returns it; `forceTranscode` on video only; audio copied. Target: `StreamTarget` on an OPFS or user-chosen file for long videos, `BufferTarget` for short ones; MP4 with `fastStart: false` (least memory) or `'in-memory'` for short clips [14].
5. **Save**: download or Web Share. Metadata (GPS, device) is not carried over unless copied explicitly; check Mediabunny's metadata tags behaviour in the implementation.

### Worker layout

- **Main thread**: UI, file picking, progress, review overlay. Holds no frames.
- **Pipeline worker** (one, v1): owns Mediabunny, the MediaPipe detector (WebGL2 on an `OffscreenCanvas`), the tracker and the renderer. Detection is synchronous here, which is fine because nothing else runs on this thread. Messages to the main thread: progress, tracks, final file handle.
- **v2 if profiling shows it pays**: split decoding and detection into two workers and transfer `VideoFrame`s between them so decode of frame n+1 overlaps detection of frame n. Do not split before measuring; transfers and frame lifetime rules add failure modes.

## Data shape: faces over time

Coordinates normalised to the displayed frame (after rotation), top-left origin, `x, y, w, h` in [0, 1]; time in seconds of presentation time, because both WebCodecs (microseconds) and the cloud APIs (milliseconds, `Duration` strings) convert to it losslessly enough, and frame indices are not stable across variable frame rate. Expressed as TypeScript; in the facade this would be a Zod schema so a cloud response can be validated at the boundary.

```ts
type NormBox = { x: number; y: number; w: number; h: number };

type ObservationSource = 'detected' | 'predicted' | 'interpolated' | 'held' | 'manual';

interface FaceObservation {
  t: number;                      // seconds, presentation time
  box: NormBox;                   // undilated; margins belong to the covering policy
  score?: number;                 // detector confidence, if detected
  source: ObservationSource;
  landmarks?: { x: number; y: number; kind?: string }[];
  roll?: number;                  // radians, from eye key points
}

interface FaceTrack {
  id: string;                     // stable within one result
  observations: FaceObservation[]; // sorted by t
  score?: number;                 // track-level confidence
  attributes?: Record<string, unknown>;
}

interface FacesOverTime {
  schema: 'faces-over-time/1';
  media: { width: number; height: number; duration: number; fps?: number };
  producer: { name: string; version: string; model?: string; params?: Record<string, unknown> };
  sampling: { kind: 'every-frame' | 'every-n' | 'irregular'; intervalS?: number };
  tracks: FaceTrack[];
}
```

How sources fill it:

- **Browser tracker**: one `FaceTrack` per track; detections as `detected`, Kalman predictions as `predicted`; the policy may add `held` and `interpolated` observations or compute them at render time (keeping them out of the stored result keeps the data honest about what was seen).
- **Google Video Intelligence** [49]: `tracks[]` → `FaceTrack`; `timestampedObjects[]` → observations with `t = timeOffset`, `{left, top, right, bottom}` → `{x: left, y: top, w: right - left, h: bottom - top}`, `source: 'detected'`.
- **Amazon Rekognition** [48]: flat `Faces[]`; `t = Timestamp / 1000`, `BoundingBox {Left, Top, Width, Height}` maps directly. No ids: run the same browser tracker over the detections to group them, and set `sampling.kind: 'irregular'` because frames are not guaranteed.
- **Azure Video Indexer** [50]: face `id` → track id; insight `instances` give time ranges only, so per-frame boxes must come from the `faces.json` artifact (field names not verified here).
- **`deface` or any per-frame detector**: like Rekognition, detections then tracker.

The renderer only needs one query, `coversAt(t, tracks, policy) → NormBox[]`, so the same pass 2 works whether the tracks came from the browser, a cloud API, or a human edit.

## What burns/ts gives us

Read: `$PP/r/burns/ts/src/render-webcodecs.ts`, `src/mux-webm.ts`, `package.json` (npm `kenburnz` 0.0.1, MIT).

Reusable:

- `isWebCodecsSupported()`: the feature gate (extend with `VideoDecoder` and an `isConfigSupported` probe).
- The architecture: a pure, Node-tested plan (`planFrames`) separated from a browser-only encode loop. The face pipeline has the same split: tracks and the covering policy are pure and testable in Node; decode, detect and encode are browser-only and tested with Playwright (burns already has a Playwright e2e setup).
- The `onChunk(chunk, meta)` seam and the optional-peer, dynamic-`import()` pattern in `mux-webm.ts`, which keeps muxing out of the core bundle.

Not reusable as is:

- `mux-webm.ts` wraps `webm-muxer`, which npm marks deprecated in favour of Mediabunny [19]; there is no MP4 path (the file itself says "a future `mux-mp4.ts`").
- `exportWebCodecsVideo` calls `encoder.encode()` in a tight loop with no `encodeQueueSize` or `dequeue` check, so every frame is queued at once. Harmless for a short clip from one still image; for re-encoding a long video it would grow memory without bound [7][9].
- Defaults: VP9 in WebM, which does not play natively on macOS or iOS [6]; keyframe every `fps` frames.
- No demux, no decode, no audio: its input is a single still image.

Suggested direction (not done here; this task was read-only): move burns' export onto Mediabunny too, so both packages share one media layer, and file that as an issue on burns. Minor: `package.json` gives the repository as `thorwhalen/burns` while the checkout's remote is `reeleehq/burns`.

## Open questions for implementation

- Per-frame cost of MediaPipe full-frame plus tiled detection in a worker on a mid-range phone; this sets N (detection cadence) and the tiling cadence. Measure first.
- Whether Mediabunny's `process` callback runs fast enough with a 2D `OffscreenCanvas`, or whether drawing covers needs WebGL.
- Variable-frame-rate phone videos and rotation metadata: verify that `sample.timestamp` and display orientation line up with the detection pass's coordinates.
- A small annotated test set (public-domain or self-recorded clips, kept outside the repository per Faceover's practice [1]) for the three metrics above.

## REFERENCES

1. Faceover. Face detection and de-identification in the browser: options for Faceover. `$PP/tt/faceover/docs/research/face-detection-in-browser.md`. 2026-11-25.
2. caniuse. [VideoDecoder API](https://caniuse.com/mdn-api_videodecoder). Accessed 2026-11-25.
3. caniuse. [VideoEncoder API](https://caniuse.com/mdn-api_videoencoder). Accessed 2026-11-25.
4. caniuse. [AudioDecoder API](https://caniuse.com/mdn-api_audiodecoder). Accessed 2026-11-25.
5. Apple. [Safari 26 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes) (adds WebCodecs AudioEncoder and AudioDecoder).
6. MDN. [WebCodecs API: Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection). Accessed 2026-11-25.
7. W3C. [WebCodecs](https://www.w3.org/TR/webcodecs/), Working Draft, 2026 (definitions of codec system resources and saturation; note under `VideoDecoder.decode`).
8. MDN. [VideoFrame](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame). Accessed 2026-11-25.
9. MDN. [VideoDecoder: dequeue event](https://developer.mozilla.org/docs/Web/API/VideoDecoder/dequeue_event). Accessed 2026-11-25.
10. Vanilagy. [Mediabunny](https://github.com/Vanilagy/mediabunny). GitHub; MPL-2.0; npm 1.66.4.
11. Mediabunny. [Introduction](https://mediabunny.dev/guide/introduction). Accessed 2026-11-25.
12. Mediabunny. [Converting media files](https://mediabunny.dev/guide/converting-media-files). Accessed 2026-11-25.
13. Mediabunny. [Media sinks](https://mediabunny.dev/guide/media-sinks). Accessed 2026-11-25.
14. Mediabunny. [Full documentation (output formats, fastStart, targets, workers)](https://mediabunny.dev/llms-full.txt). Accessed 2026-11-25.
15. Mediabunny. [@mediabunny/aac-encoder](https://mediabunny.dev/guide/extensions/aac-encoder). Accessed 2026-11-25.
16. Mediabunny. [@mediabunny/server](https://mediabunny.dev/guide/extensions/server). Accessed 2026-11-25.
17. Bundlephobia. [mediabunny@1.66.4](https://bundlephobia.com/package/mediabunny@1.66.4) (763,718 B min, 193,154 B gzip) and [mp4box@2.6.0](https://bundlephobia.com/package/mp4box@2.6.0) (206,450 B min, 47,068 B gzip). Accessed 2026-11-25.
18. npm. [mp4-muxer](https://www.npmjs.com/package/mp4-muxer) 5.2.2, deprecated: "superseded by Mediabunny".
19. npm. [webm-muxer](https://www.npmjs.com/package/webm-muxer) 5.1.4, deprecated: "superseded by Mediabunny".
20. GPAC. [mp4box.js](https://github.com/gpac/mp4box.js). GitHub; BSD-3-Clause; npm 2.6.0.
21. ffmpegwasm. [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm). GitHub; `@ffmpeg/ffmpeg` 0.12.15, MIT.
22. npm. [@ffmpeg/core](https://www.npmjs.com/package/@ffmpeg/core) 0.12.10, GPL-2.0-or-later; `ffmpeg-core.wasm` 32,232,419 B (from the package tarball).
23. ffmpegwasm. [Issue 623: file size limit](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/623). GitHub.
24. ffmpegwasm. [Performance](https://ffmpegwasm.netlify.app/docs/performance). Accessed 2026-11-25.
25. caniuse. [OffscreenCanvas](https://caniuse.com/offscreencanvas). Accessed 2026-11-25.
26. WebKit. [Bug 183720: OffscreenCanvas](https://bugs.webkit.org/show_bug.cgi?id=183720) (WebGL in workers requires macOS Sonoma / iOS 17).
27. Google. [Face detection guide for Web (MediaPipe)](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js). Accessed 2026-11-25.
28. Google. [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 1.2.3, Apache-2.0 (typings `vision.d.ts` and wasm sizes read from the tarball).
29. web.dev. [Perform efficient per-video-frame operations on video with requestVideoFrameCallback()](https://web.dev/articles/requestvideoframecallback-rvfc).
30. caniuse. [requestVideoFrameCallback](https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback). Accessed 2026-11-25.
31. caniuse. [MediaStreamTrackProcessor](https://caniuse.com/mdn-api_mediastreamtrackprocessor). Accessed 2026-11-25.
32. MDN. [Insertable Streams for MediaStreamTrack API](https://developer.mozilla.org/en-US/docs/Web/API/Insertable_Streams_for_MediaStreamTrack_API).
33. Mozilla WebRTC blog. [Unbundling MediaStreamTrackProcessor and VideoTrackGenerator](https://blog.mozilla.org/webrtc/unbundling-mediastreamtrackprocessor-and-videotrackgenerator/).
34. W3C. [MediaStreamTrack Insertable Media Processing using Streams](https://www.w3.org/TR/mediacapture-transform).
35. Bewley A, Ge Z, Ott L, Ramos F, Upcroft B. [Simple Online and Realtime Tracking](https://arxiv.org/abs/1602.00763). ICIP 2016. Code: [abewley/sort](https://github.com/abewley/sort), GPL-3.0.
36. Zhang Y, et al. [ByteTrack: Multi-Object Tracking by Associating Every Detection Box](https://arxiv.org/abs/2110.06864). ECCV 2022. Code: [FoundationVision/ByteTrack](https://github.com/FoundationVision/ByteTrack), MIT.
37. Cao J, et al. [Observation-Centric SORT: Rethinking SORT for Robust Multi-Object Tracking](https://arxiv.org/abs/2203.14360). CVPR 2023. Code: [noahcao/OC_SORT](https://github.com/noahcao/OC_SORT), MIT.
38. Roboflow. [trackers](https://github.com/roboflow/trackers). GitHub; Apache-2.0; [docs](https://trackers.roboflow.com/latest/).
39. Casiez G, Roussel N, Vogel D. [1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems](https://hal.science/hal-00670496). CHI 2012:2527-30. [Authors' page with tuning procedure](https://cristal.univ-lille.fr/~casiez/1euro).
40. npm. [1eurofilter](https://www.npmjs.com/package/1eurofilter) 1.3.0, BSD-3-Clause ([casiez/OneEuroFilter](https://github.com/casiez/OneEuroFilter)).
41. npm. [kalman-filter](https://www.npmjs.com/package/kalman-filter) 2.3.0, MIT ([piercus/kalman-filter](https://github.com/piercus/kalman-filter)).
42. Google. [Face landmark detection guide (MediaPipe)](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker). Accessed 2026-11-25.
43. ORB-HD. [deface: Video anonymization by face detection](https://github.com/ORB-HD/deface). GitHub; MIT (README options and `deface/deface.py` read via the GitHub API).
44. Xu Y, Yan W, Sun H, Yang G, Luo J. [CenterFace: Joint Face Detection and Alignment Using Face as Point](https://arxiv.org/abs/1911.03599). 2019. [Star-Clouds/CenterFace](https://github.com/Star-Clouds/CenterFace), MIT.
45. brighter AI. [Product](https://brighter.ai/product/) and [API documentation](https://docs.brighter.ai/). Accessed 2026-11-25.
46. Google. [Blur your videos (YouTube Help)](https://support.google.com/youtube/answer/9057652). Accessed 2026-11-25.
47. Signal. [Blur tools for Signal](https://signal.org/blog/blur-tools/). 2020-06-03.
48. Amazon. [GetFaceDetection](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceDetection.html) and [FaceDetection](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_FaceDetection.html). Amazon Rekognition API Reference.
49. Google Cloud. [Face detection (Video Intelligence)](https://docs.cloud.google.com/video-intelligence/docs/face-detection) and [AnnotateVideoResponse REST reference](https://docs.cloud.google.com/video-intelligence/docs/reference/rest/v1/AnnotateVideoResponse).
50. Microsoft. [Redact faces by using Azure AI Video Indexer API](https://learn.microsoft.com/en-us/azure/azure-video-indexer/face-redaction-with-api) and [Get face detection insights](https://learn.microsoft.com/en-us/azure/azure-video-indexer/face-detection). Updated 2026-06-16.
51. scryingorb. [Faceveil](https://github.com/scryingorb/Faceveil). GitHub; no licence; created 2026-09-26.
52. Frome A, Cheung G, et al. [Large-scale Privacy Protection in Google Street View](https://research.google/pubs/large-scale-privacy-protection-in-google-street-view/). ICCV 2009:2373-80.
53. Angus A, Duan Z, Zussman G, Kostic Z. [Real-Time Video Anonymization in Smart City Intersections](https://par.nsf.gov/biblio/10406096-real-time-video-anonymization-smart-city-intersections). 2022.
54. Raina N, et al. [EgoBlur: Responsible Innovation in Aria](https://arxiv.org/abs/2308.13093). 2023.
55. [DisguisOR: holistic face anonymization for the operating room](https://link.springer.com/article/10.1007/s11548-023-02939-6). Int J Comput Assist Radiol Surg. 2023.
56. [Self-Supervised Uncalibrated Multi-View Video Anonymization in the Operating Room](https://arxiv.org/html/2602.02850). arXiv:2602.02850; 2026.
57. [Temporally coherent video anonymization through GAN inpainting](https://arxiv.org/abs/2106.02328). arXiv:2106.02328; 2021.
58. Yang S, Luo P, Loy CC, Tang X. [WIDER FACE: A Face Detection Benchmark](https://mmlab.ie.cuhk.edu.hk/projects/WIDERFace/). CVPR 2016.
59. McPherson R, Shokri R, Shmatikov V. [Defeating Image Obfuscation with Deep Learning](https://arxiv.org/abs/1609.00408). arXiv:1609.00408; 2016.
