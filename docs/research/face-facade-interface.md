# What face APIs have in common, and a common interface for them

- **Theme:** 3 of the face-facade research (the interface). Sibling reports inventory the browser libraries and the video pipeline; this one does not repeat them.
- **Date:** 2026-11-25
- **First consumer:** Faceover (`$PP/tt/faceover`, branch `e2e-live` at the time of reading).
- **Status:** a proposal. Nothing is built, committed or posted.

## 0. Headline findings

1. **No face facade exists in the fleet** (step 0 of the maintainer's facade doctrine [1]). There are four separate face seams, each with its own `Face` type and its own box convention: burns (normalised `(x, y, w, h)` tuples) [6], cutan (`(x0, y0, x1, y1)` pixels plus jaw and landmarks) [7], lookbook (`{x1, y1, x2, y2}` integer pixels, `confidence`, five landmarks) [8], and Faceover (`{x, y, w, h}` pixels with six keypoints as an unnamed ordered array, roll in radians) [9]. An in-house webcam app holds the best TypeScript prior art: a head pose decoder from MediaPipe's transformation matrix (in degrees), capture-time frame stamps, one asset resolver for wasm and models, a lazy-loading pattern, and a block on MediaPipe's usage telemetry [10].
2. **Every face API returns the same core**: a box, a score, a few named points, and often a head pose. They disagree on *units* for all four. Boxes come as pixels (Azure, Google Vision, MediaPipe, Human, Shape Detection), as ratios (AWS, Google Video), or both inside one result (MediaPipe: pixel box, normalised keypoints [23]). Scores run 0–100 (AWS [11]) or 0–1 (everyone else). Angles are degrees (AWS, Azure, Google, an in-house webcam app, lookbook) or radians (Human [28], Faceover).
3. **"Left eye" means different things in different APIs, and this is the trap to design out.** Google says outright that `LEFT_EYE` "typically, is the person's right eye" (viewer's frame) [16]. MediaPipe's six keypoints are anatomical (subject's right eye first) [22]. Insightface's ArcFace template lists the image-left eye first [34]. Azure's sample has `pupilLeft` at the smaller x, so viewer's frame [19]. AWS does not say [12]. The TF.js face-detection README sample has `rightEye` at the *larger* x [32]. The canonical vocabulary must fix one frame (proposal: **anatomical**, the subject's own left), and every adapter must pass a fixture test that pins it.
4. **Video results come in two shapes.** AWS returns a flat, time-sorted list of `{Timestamp (ms), Face}` with no identity across frames [15]. Google Video Intelligence returns tracks, each a segment with timestamped boxes on a normalised `left/top/right/bottom` box [17]. MediaPipe's VIDEO mode returns one result per frame you feed it, with a ms timestamp and no track ids [24]. So the canonical form should be **frame-major** (a stream of frames, each with its faces), with `trackId` an optional per-face field. Track-major is a pure derived view, and a tracker is a separate seam.
5. **Capability honesty differs inside a single vendor.** AWS `GetFaceDetection` always returns `FaceOccluded` and `EyeDirection` as null, while the image endpoint fills them [15]. Azure's detect returns a server-side `faceId` *by default* (`returnFaceId` defaults to true). Identification and verification are Limited Access: registration only, Microsoft-managed customers only, not on the free tier. Detection itself needs no registration [19][20]. Capabilities therefore have to be declared per backend *and per mode*, as data.
6. **Privacy is a capability field, and for Faceover it is the main one.** An in-house webcam app found that `@mediapipe/tasks-vision` 1.1.1 POSTs usage figures (no images) to `odml.pa.googleapis.com`. It blocks those posts in code, because the library has no option to turn them off [10]. Faceover's CSP refuses the request. I have not checked whether 1.2.3 (Faceover's version) still sends it. A backend's declaration should carry `imageLeavesDevice` and `thirdPartyHosts`, and the facade should refuse remote backends unless the caller passes `allowRemote: true` (fail closed, the same pattern as the fleet's licence gate [1]).
7. **The proposed interface** has three verbs: `detect(image)`, `track(frames)`, and later `embed(image, faces)`. It has one Zod result schema in image pixels (top-left origin, degrees, scores 0..1, named anatomical keypoints, dense meshes tagged with a topology id). Backends are values declared as data (`emits`, `accepts`, `modes`, `privacy`, `assets`, `license`). There is one enforcement path that adapters cannot bypass, a three-rung escape hatch, and per-backend subpath exports loaded with dynamic import. **v1 = MediaPipe Face Detector (default) + MediaPipe Face Landmarker**: both come from the dependency Faceover already has, so v1 needs no new dependency. Five seams: `backend`, `tracker`, `executor`, `assets`, `tiling`.

## 1. The maintainer's facade doctrine, and the two in-house patterns

### 1.1 The doctrine [1][2][3]

A facade has three parts: the common part (verbs, canonical vocabulary, one result type), **capability honesty** (what each target really accepts and really emits, declared as data and enforced on the one path every call takes), and **escape hatches** (three rungs: canonical kwargs → per-backend native params → the raw call; plus `result.raw`). The rules that matter most for this design:

- A canonical name is promoted only when **at least two targets** share the concept (the promotion rule [1]).
- `accepts` and `emits` are separate declarations. ocracy's words came back empty on four engines because nothing declared what the adapter emits [2].
- Enforce in a method subclasses cannot override (ocracy's `BaseOcrAdapter.read`, illustration's template method), never only in the root function (arioso#6) [2][3].
- Unsupported parameter: drop and record in `notes`, but **raise for meaning-carrying parameters** [1].
- An unknown backend id raises with the valid list and never falls back (ef's typo route) [2].
- Default = keyless, local, free, working. Never paid [1].
- A machine-readable **ledger** of every researched target, with `implemented` computed live [2][4].

### 1.2 ocracy (one `ocr()` over ~15 engines) [4]

- **Verb:** `ocr(image, *, backend=None, **kwargs) -> OcrResult`, plus `read_text`, `find(**criteria)` over the ledger, `services.<id>.read(...)`, and `services.<id>.adapter` (raw).
- **Result:** `OcrResult(text, blocks, backend, raw, meta)`. `TextBlock(text, bbox, confidence, level, language, meta)`. `BBox(x0, y0, x1, y1, polygon)` in pixels, top-left origin, with `from_xywh`, `from_polygon`, `.xywh` and `.as_tuple` converters. **Confidence is normalised to [0, 1] by the facade** (`normalize_confidence(value, scale=100)` for Tesseract). That is the same move AWS's 0–100 face confidence needs.
- **Capabilities:** a `BACKEND_CONFIG` dict per backend (`param_map`, `is_local`, `is_remote`, `license`, `pip_install`, `import_name`), plus a 64-record ledger (`data/backends.json`, documented in `SCHEMA.md`) with fields such as `bounding_boxes`, `confidence_scores`, `handwriting`, `privacy_note`.
- **Known gap:** granularity. The engine emits words *or* lines, and nothing declares which. This is the "declare `emits`" lesson, and faces will hit it with keypoints (6 vs 5 vs 27 vs 478).
- **Placement:** translation runs inside `BaseOcrAdapter.read`, and drop notes go to `result.meta["notes"]`.

### 1.3 arioso (one `generate()` over 14 music platforms) [5]

- **Verb:** `generate(prompt, *, platform="musicgen", **kwargs) -> Song`, plus `generate_many`, `list_platforms`, `get_platform_info`.
- **Result:** `Song(id, title, status, audio: AudioResult, metadata, platform)`. The native payload goes in `metadata`.
- **Capabilities:** `PLATFORM_CONFIG` with a rich `param_map` per canonical affordance (`native_name`, `native_default`, `title`, `description`, `adapter_handled`, `optional_with`), plus an `AFFORDANCES` registry of canonical names with type, bounds and UI hints (`multiline`). From that registry arioso generates a JSON Schema per platform for forms (`arioso/schema.py`). This maps directly to a Zod world: the canonical option schema *is* the form.
- **Lesson:** the checks are called in `generate` and `generate_many` (root functions), not in the adapter, which is arioso#6's bypass [2].

### 1.4 What transfers to TypeScript, and what does not

| Python house style | TypeScript equivalent | Why it changes |
|---|---|---|
| `backend="id"` string, `pkgutil` discovery | **Backend passed as a value** (`backend: mediapipe()`), imported from a subpath (`faces/mediapipe`). A string id works only after `register()`. | Bundlers resolve imports statically. A core that names every backend's module would pull every peer dependency into the build, or fail when one is missing. Dependency injection keeps a backend out of the bundle until the app imports it. |
| Zero-dep core + one pip extra per backend | Core depends only on `zod`. Each backend's library is an **optional peer dependency**, loaded by `import()` inside the backend's `load()`. The default backend's library is a regular dependency. | Same principle; npm's mechanism. |
| `BACKEND_CONFIG` dict | A `BackendInfo` object validated by Zod, exported by each subpath *without* importing the library. The ledger is JSON in core. | Data stays importable without code, so the bundle stays small and `find()` works offline. |
| `BaseAdapter.__call__` (one path) | Core function `run()`; adapters supply only `load`, `call` and `normalise` | The TS form of a template method. |
| `raw` field | Non-enumerable `raw` on results, excluded from `toJSON` | Native results can hold tensors (Human `tensor` [26]) or `ImageBitmap`s. They must not break the JSON contract or the worker boundary. |

## 2. The in-house face shapes

| Owner | Type | Box | Units | Score | Points | Extras | Detector seam |
|---|---|---|---|---|---|---|---|
| burns [6] | `Box = tuple[4]` | `(x, y, w, h)` | normalised [0,1], top-left | none | none | none | `FacesDetector = Callable[[image], Sequence[Box]]` |
| cutan [7] | `Face` frozen dataclass | `box=(x0, y0, x1, y1)` | pixels | `score=1.0` (hand box) | `jaw` (≥3 pts, ear to ear), `landmarks` (all detector points, here insightface 106) | `of()` / `as_dict()` JSON round trip; `pick_face(largest/leftmost/rightmost/best)` | `FaceLocator = Callable[[rgb], Sequence[Face]]`, default `InsightFaceLocator` |
| lookbook [8] | `face_box` manifest value (dict) or `None` | `{x1, y1, x2, y2}` ints | pixels | `confidence` | `landmarks`: 5 `[x, y]` (insightface `kps`) | `n_faces`; separate `head_pose` metric `{yaw, pitch, roll}` in **degrees** with bins; ArcFace embedding (512, L2-normalised, `space_id="arcface"`); `SimilarityResult` | registry-named scorers with `requires=("face_box",)`; embedder injected |
| Faceover [9] | `Detection` (Zod) | `{x, y, w, h}` | pixels | `score` | `keypoints: {x, y}[]` in MediaPipe order (by position, no names) | `Face` (app object: `cx, cy, size, angle` in **radians**, `scale`, `source`, `transform`) | `DetectFn = (canvas) => Promise<Detection[]>` |
| An in-house webcam app [10] | `FaceFrame` | none | normalised landmarks | none | 478 mesh `{x, y, z?}` | 52 blendshapes, `HeadPose {yaw, pitch, roll}` in **degrees** from the 4×4 matrix (Y-X-Z Tait–Bryan), `FrameTiming {t (s), tSource, tOrigin, lag, skipped}` | DAG source node, lazy |

What they agree on: a detector is injected as a function from an image to a list of faces, and an empty list means none found (all five). Pose in degrees as `{yaw, pitch, roll}` (lookbook and an in-house webcam app). Scores in [0, 1]. What they disagree on: tuple vs object, xywh vs xyxy, normalised vs pixels, `score` vs `confidence`, keypoints by position vs by name. Positional tuples are the root problem: `(a, b, c, d)` means xywh in burns and xyxy in cutan, and only the docstring says which. **The shared shape should use named keys** (`{x, y, w, h}`), which also makes it self-describing JSON.

Faceover's `Face` is an *app* object (a cover to draw: centre, size, scale, transform). It is not a detection, and the facade must not absorb it. The facade replaces `Detection`, and `faceFromDetection` stays in Faceover. Naming the facade's type **`DetectedFace`** (the W3C Shape Detection name [29]) avoids the clash.

## 3. What the face APIs return

### 3.1 Per target

| Target | Call | Box | Score | Landmarks | Pose | Quality / occlusion | Attributes | Identity | Video / time |
|---|---|---|---|---|---|---|---|---|---|
| **AWS Rekognition** image [11][12][13][14] | `DetectFaces(Image, Attributes=[DEFAULT\|ALL…])` | `BoundingBox {Left, Top, Width, Height}`, **ratios** of the image; may be negative or > 1 for partial faces | `Confidence` **0–100** | 30 typed points (`eyeLeft, eyeRight, nose, mouthLeft, mouthRight, leftPupil, rightPupil, upperJawlineLeft … chinBottom …`), X and Y as ratios; left/right frame **not stated** | `Pose {Pitch, Roll, Yaw}`, range −180..180 | `Quality {Brightness, Sharpness}`; `FaceOccluded {Value, Confidence}`; `EyeDirection {Yaw, Pitch}` | AgeRange, Gender, Emotions, Smile, Eyeglasses, Sunglasses, Beard, Mustache, EyesOpen, MouthOpen | `IndexFaces` stores a FaceId in a collection | — |
| **AWS Rekognition** video [15] | `StartFaceDetection` → SNS → `GetFaceDetection(JobId, NextToken)` | same | same | same | same | `FaceOccluded`, `EyeDirection` **always null** here | same | none | `Faces: [{Timestamp (ms), Face}]` sorted by time, paginated (1000 per page), **no track id**; `VideoMetadata {FrameRate, FrameWidth, FrameHeight, DurationMillis}` |
| **Google Cloud Vision** [16] | `images:annotate` with `FACE_DETECTION` | `boundingPoly` (head-framing, from landmarks) and `fdBoundingPoly` (tighter, skin only), polygons in image pixels | `detectionConfidence` and `landmarkingConfidence`, 0..1 | ~34 typed points incl. `LEFT_EYE, NOSE_TIP, MOUTH_LEFT, LEFT_EAR_TRAGION, CHIN_GNATHION`, `{x, y, z}` in image scale; **left/right are the viewer's** ("`LEFT_EYE`, typically, is the person's right eye") | `rollAngle, panAngle, tiltAngle`, range −180..180 (pan = yaw, tilt = pitch) | `underExposedLikelihood`, `blurredLikelihood`, `headwearLikelihood` | joy/sorrow/anger/surprise **likelihood enums** (`VERY_UNLIKELY … VERY_LIKELY`) | none | — |
| **Google Video Intelligence** [17][18] | `videos:annotate`, `FACE_DETECTION`, `faceDetectionConfig {model, includeBoundingBoxes, includeAttributes}`; long-running operation | `normalizedBoundingBox {left, top, right, bottom}` (normalised **xyxy**) | per track and per attribute | landmarks per timestamped object (name, point, confidence); not all detailed in the pages read | none documented | attributes such as glasses, headwear, smiling (`smiling` deprecated 2026-10-15, removed 2027-01-14 [17]) | | none | **track-major**: `tracks[] {segment {startTimeOffset, endTimeOffset as "3.1s" strings}, timestampedObjects[] {timeOffset, normalizedBoundingBox, attributes, landmarks}}`, plus a base64 `thumbnail` |
| **Azure AI Face** [19][20] | `POST /face/v1.2/detect?detectionModel&returnFaceId&returnFaceLandmarks&returnFaceAttributes` | `faceRectangle {top, left, width, height}` **integer pixels**; sorted by size, largest first; ≤ 100 faces | none | 27 named points (`pupilLeft, noseTip, mouthLeft, eyeLeftOuter, upperLipTop …`) in pixels; the sample puts `pupilLeft` at the smaller x (viewer's frame) | `headPose {pitch, roll, yaw}` | `blur {blurLevel, value 0..1}`, `exposure`, `noise`, `occlusion {foreheadOccluded, eyeOccluded, mouthOccluded}`, `mask`, `qualityForRecognition` | **emotion and gender retired**; age, smile, facial hair, hair and makeup limited | `faceId` (uuid, TTL 60 s–24 h), **returned by default**; identify/verify are Limited Access: registration, Microsoft-managed customers only, not on F0 | — |
| **Face++** [21] | Detect API | face rectangle plus a `face_token` (field names not verified: the docs page did not render) | — | "106/83 landmarks", for the **top 5 largest faces only** | head pose (listed) | blurriness, face quality (listed) | age, gender, emotion, beauty, skin… (listed) | `face_token` passed to other APIs | — |
| **MediaPipe Face Detector** (web) [22][23][24] | `FaceDetector.detect(image)` / `detectForVideo(frame, timestampMs)`; `runningMode` **IMAGE or VIDEO only on web**; `minDetectionConfidence`, `minSuppressionThreshold` | `boundingBox {originX, originY, width, height}` **pixels** | `categories[0].score` 0..1 | **6 keypoints, normalised** 0..1, in order: right eye, left eye, nose tip, mouth centre, right ear tragion, left ear tragion (anatomical) | none | none | none | none | caller-fed frames with ms timestamps; no track ids |
| **MediaPipe Face Landmarker** [25] | same task API; `numFaces`, `minFaceDetectionConfidence`, `minFacePresenceConfidence`, `minTrackingConfidence`, `outputFaceBlendshapes`, `outputFacialTransformationMatrixes` | none (derive from mesh) | — | **478** 3-D points, normalised | from the 4×4 matrix (an in-house webcam app decodes it [10]) | — | **52 blendshapes** | none | VIDEO = "synchronous tracking across decoded frames"; temporal smoothing when `numFaces = 1` |
| **Human** (`@vladmandic/human`) [26][27][28] | `human.detect(input)`; config tree `face.{detector, mesh, iris, description, emotion, antispoof, liveness, …}.enabled/modelPath`, `backend` | `box: [x, y, w, h]` pixels **and** `boxRaw` normalised | `score`, `boxScore`, `faceScore` | `mesh`/`meshRaw` (468/478), `annotations: Record<FaceLandmark, Point[]>` (named groups: `leftEye, noseTip, lipsUpperOuter, silhouette …`) | `rotation.angle {roll, yaw, pitch}` in **radians**, `matrix` 3×3, `gaze {bearing, strength}` | — | age, gender, emotion, race (optional modules) | `embedding: number[]` (face descriptor), `real`, `live` | `result.timestamp` (epoch ms); `face.id: number` |
| **Shape Detection API** `FaceDetector` [29][30] | `new FaceDetector({maxDetectedFaces, fastMode}).detect(ImageBitmapSource)` | `boundingBox: DOMRectReadOnly` pixels | none | `landmarks[] {locations: Point2D[], type: 'eye'\|'mouth'\|'nose'}`, **no left/right** | none | none | none | none | WICG draft, not standards track; in Chrome face detection is still **behind a flag** |
| **TF.js face-detection** [32][33] | `createDetector(model, {runtime: 'mediapipe' \| 'tfjs', …}).estimateFaces(image)` | `box {xMin, xMax, yMin, yMax, width, height}` pixels | — | named: `rightEye, leftEye, noseTip, mouthCenter, rightEarTragion, leftEarTragion`, pixels | — | — | — | — | a small two-runtime facade, the closest existing JS precedent |
| **transformers.js** [31] | `pipeline('object-detection', model)(img, {threshold, percentage})`; `image-feature-extraction` for embeddings | `box {xmin, ymin, xmax, ymax}`, pixels by default, percentages with `percentage: true` | `score` | none | none | none | `label` | feature `Tensor` | generic vision pipelines, not face-specific |

### 3.2 The jargon table (concept × target) and the promotion verdict

| Concept | AWS | Google | Azure | MediaPipe | Human | Shape Det. | in-house | Canonical name (promoted?) |
|---|---|---|---|---|---|---|---|---|
| face region | BoundingBox | boundingPoly / fdBoundingPoly | faceRectangle | boundingBox | box | boundingBox | box / face_box | **`box {x, y, w, h}`** px (yes, all) |
| detection confidence | Confidence (0–100) | detectionConfidence | — | categories[0].score | score / boxScore | — | score / confidence | **`score` 0..1** (yes) |
| points | Landmarks[Type] | landmarks[type] | faceLandmarks.{name} | keypoints[i] | annotations / mesh | landmarks[type] | keypoints / landmarks / kps | **`keypoints` (named, anatomical)** + **`mesh` (topology-tagged)** (yes) |
| head orientation | Pose {Yaw, Pitch, Roll} | pan / tilt / roll | headPose | matrix | rotation.angle | — | head_pose / HeadPose | **`pose {yaw, pitch, roll}` degrees** (yes; `pan`/`tilt` are Google's names for yaw/pitch) |
| blur | Quality.Sharpness | blurredLikelihood | blur.value | — | — | — | lookbook sharpness scorer | **`quality.blur` 0..1** (yes, 3 targets; v2) |
| occlusion | FaceOccluded | (headwear) | occlusion.{…} | — | — | — | — | **`quality.occluded` 0..1** (yes, 2; v2) |
| exposure / brightness | Quality.Brightness | underExposedLikelihood | exposure | — | — | — | lookbook exposure | **`quality.exposure`** (yes; v2) |
| expression | Emotions | joy/sorrow… likelihoods | (retired) | blendshapes | emotion | — | An in-house webcam app blendshapes | **not canonical**: categories are incompatible (labels vs likelihood enums vs 52 muscle activations). `blendshapes` stays native until a second backend emits the ARKit-style set |
| demographics | AgeRange, Gender | — | age (limited), gender (retired) | — | age, gender, race | — | — | **never canonical** (ethics; Azure retired them [19]); reachable only through `raw` |
| identity vector | (server-side collections) | — | (server-side faceId) | — | embedding | — | lookbook arcface 512 | **`embedding {space, vector}`** (yes: Human, insightface/ArcFace, ONNX) |
| server handle | FaceId (IndexFaces) | — | faceId (TTL) | — | — | — | — | **`ref {backend, id, expiresAt}`** (yes: AWS, Azure, Face++) |
| time | Timestamp (ms) | timeOffset ("3.1s") | — | timestamp (ms) | timestamp (epoch ms) | — | An in-house webcam app `t` (s) | **`t` seconds, media time** (yes) |
| identity across frames | — | track | — | (internal) | id | — | — | **`trackId`** (yes: Google tracks, trackers) |

## 4. Conventions the canonical schema must fix

1. **Coordinates:** image **pixels** of the image passed in, top-left origin, x right, y down. The image is decoded with EXIF orientation applied (`createImageBitmap(blob, {imageOrientation: 'from-image'})`). Rationale: Faceover, Azure, Google Vision, MediaPipe's box, Human's `box`, Shape Detection, TF.js and transformers.js already return pixels. Every result carries `image: {width, height}`, so normalising is a pure function (`normalised(result)`), and burns-style ratios are one call away. Boxes are **not clamped**: AWS returns partial faces outside [0, 1] [13], and a privacy cover must still cover the part that is inside.
2. **Box:** an object `{x, y, w, h}` (xywh) with named keys: the form Faceover, MediaPipe, AWS, Azure, Human and COCO [35] use. Converters `toXyxy` / `fromXyxy` live in core, so cutan's and lookbook's xyxy are a function call away.
3. **Score:** [0, 1]. Adapters divide AWS by 100 (ocracy's `normalize_confidence(scale=100)` precedent [4]). A backend with no score (Shape Detection, Azure) reports `score: null`, not 1. A hand-placed face is 1 by convention, as in cutan [7]. Never invent a confidence.
4. **Angles:** **degrees**, `{yaw, pitch, roll}`. Five sources use degrees; Human and Faceover use radians and convert at the boundary. Sign convention (proposal; none of the pages read states a sign): in the **camera frame**, roll > 0 = the face rotated clockwise as displayed (this is what Faceover's `rollFromKeypoints` already computes, in radians); yaw > 0 = the face turned toward the image's right; pitch > 0 = the face tilted up. Each adapter pins its signs with fixtures (§6.4).
5. **Left and right: anatomical (the subject's own).** This matches MediaPipe [22], COCO keypoints [35] and the medical meaning of the words, and it survives mirroring: a selfie preview shown mirrored does not change which eye is the subject's left. Adapters for viewer-frame APIs swap names (Google [16], Azure per its sample [19], insightface's image-left-first `kps` [34]). AWS is undocumented and must be measured. Invariant for an upright, unmirrored, frontal face: `keypoints.leftEye.x > keypoints.rightEye.x`.
6. **Named keypoints vs dense meshes.** The core keypoint vocabulary is the points at least two targets share: `rightEye, leftEye, noseTip, mouthCenter, mouthRight, mouthLeft, rightEar, leftEar`. The eyes are eye centres or pupils, and the ears are tragions. The five points `leftEye, rightEye, noseTip, mouthLeft, mouthRight` are exactly ArcFace's alignment input [34], so an embedder can align a face from any detector that emits them, and the capability check can say which ones do not (MediaPipe's detector has `mouthCenter`, not the corners). Dense sets (MediaPipe 478, insightface 106, Face++ 83/106, iBUG 68, Azure's 27, AWS's 30) are carried as `mesh {topology, points}` with a **topology id**, and a per-topology index table derives the named keypoints and named contours (cutan's `jaw` = insightface-106 indices 0–32 [7]).
7. **Time:** `t` in **seconds** of media time (an in-house webcam app's `FrameTiming.t` [10]). For a live stream it is capture time, with `tSource` saying where the stamp came from. Adapters convert AWS ms, Google `"3.1s"` strings and MediaPipe ms.
8. **Embeddings are only comparable inside one space.** `embedding {space, vector, normalized}`, where `space` names the model (lookbook's `space_id` [8]). `compare(a, b)` raises when the spaces differ. Server-side handles (Azure `faceId`, AWS `FaceId`, Face++ `face_token`) are a different thing: `ref {backend, id, expiresAt}`, and never `embedding`.

## 5. The proposed interface

### 5.1 Verbs (core package; name to be chosen with `short-name-free`)

```ts
// Stills
detect(image: ImageInput, opts?: DetectOptions): Promise<FaceResult>;

// Video file or live stream: the source type decides; one verb, frame-major output
track(source: FrameSource, opts?: TrackOptions): AsyncIterable<FaceFrame>;

// Later: identity vectors for faces found by ANY detector (aligned by the five points)
embed(image: ImageInput, faces: DetectedFace[], opts?: { embedder?: FaceEmbedder }): Promise<DetectedFace[]>;

// Pure helpers (no backend)
compare(a: Embedding, b: Embedding): number;          // cosine; raises across spaces
toTracks(frames: Iterable<FaceFrame>): FaceTrack[];   // track-major view
normalised(r: FaceResult): FaceResult;                // pixels -> 0..1
find(q: CapabilityQuery): BackendInfo[];              // over the ledger: "who emits a mesh, on device?"
register(b: FaceBackend): void;                       // enables string ids
```

```ts
type ImageInput = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | VideoFrame | ImageData | Blob;
type FrameSource = HTMLVideoElement | MediaStream | AsyncIterable<{ image: ImageInput; t: number }>;
type Want = 'keypoints' | 'mesh' | 'pose' | 'blendshapes' | 'quality' | 'embedding';

interface DetectOptions {
  backend?: FaceBackend | string;   // default: the MediaPipe Face Detector (lazy); an unknown string raises with the registered ids
  want?: Want[];                    // box and score always; anything wanted but not emitted RAISES, naming backends that emit it (find())
  minScore?: number;                // native where supported, else applied by core as a post-filter (recorded in notes)
  maxFaces?: number;                // MediaPipe numFaces, Human maxDetected, Shape Detection maxDetectedFaces; else top-k by score in core
  native?: Record<string, unknown>; // rung 2: passed untranslated to the selected backend, recorded in notes
  allowRemote?: boolean;            // privacy gate, default false: a backend whose image leaves the device refuses to run
  signal?: AbortSignal;
}
interface TrackOptions extends DetectOptions {
  pacing?: 'every' | 'latest';      // 'every' for files (no drops, MediaPipe VIDEO semantics); 'latest' for live (drop while busy)
  tracker?: Tracker;                // assigns trackId when the backend does not
}
```

`detect` takes `want` rather than separate `landmarks()` / `pose()` verbs. Every target bundles these as flags on one call: AWS `Attributes`, Azure `returnFaceLandmarks` / `returnFaceAttributes`, Google `includeAttributes`, MediaPipe `output*`, Human's `enabled` tree. A wanted output the backend cannot emit is meaning-carrying (a cover placed from a mesh that never came is a silent failure), so it **raises** instead of being dropped.

### 5.2 The canonical schema (Zod 4; Faceover is on 4.6.7)

```ts
import { z } from 'zod';

export const Point = z.object({ x: z.number(), y: z.number(), z: z.number().optional() }); // px; z topology-specific
export const Box = z.object({ x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative() }); // px, unclamped

export const KEYPOINTS = ['rightEye', 'leftEye', 'noseTip', 'mouthCenter', 'mouthRight', 'mouthLeft', 'rightEar', 'leftEar'] as const;
export const KeypointName = z.enum(KEYPOINTS);              // anatomical left/right
export const Keypoints = z.partialRecord(KeypointName, Point);

export const Mesh = z.object({ topology: z.string(), points: z.array(Point) }); // 'mediapipe-478', 'insightface-106', 'ibug-68', ...
export const Pose = z.object({ yaw: z.number(), pitch: z.number(), roll: z.number() }); // degrees, camera frame
export const Embedding = z.object({ space: z.string(), vector: z.array(z.number()), normalized: z.boolean() });

export const DetectedFace = z.object({
  box: Box,
  score: z.number().min(0).max(1).nullable(),            // null = the backend gives none
  keypoints: Keypoints.optional(),
  mesh: Mesh.optional(),
  pose: Pose.optional(),
  blendshapes: z.record(z.string(), z.number()).optional(), // native names (MediaPipe/ARKit); promoted when a 2nd backend emits them
  quality: z.object({ blur: z.number().min(0).max(1), occluded: z.number().min(0).max(1), exposure: z.number().min(0).max(1) }).partial().optional(),
  embedding: Embedding.optional(),
  ref: z.object({ backend: z.string(), id: z.string(), expiresAt: z.string().optional() }).optional(), // server-side handle
  trackId: z.string().optional(),
  extras: z.record(z.string(), z.unknown()).optional(),  // native-only fields, by name; JSON-safe
});

export const FaceResult = z.object({
  schema: z.literal('faces/1'),                          // cross-language contract version
  backend: z.string(),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  faces: z.array(DetectedFace),
  notes: z.array(z.string()).default([]),               // drops, post-filters, coercions: never silent
});
export const FaceFrame = FaceResult.extend({ t: z.number(), tSource: z.enum(['capture', 'presentation', 'estimated', 'clock', 'media']).optional() });
export const FaceTrack = z.object({ trackId: z.string(), start: z.number(), end: z.number(), faces: z.array(DetectedFace.extend({ t: z.number() })) });
```

`raw` (the native result) is attached as a **non-enumerable** property on `FaceResult` and on each `DetectedFace`. It is reachable in code, and it is absent from `JSON.stringify`, the worker boundary and the Python side.

**Cross-language contract.** `z.toJSONSchema(FaceResult)` is committed as `schema/faces-1.json`. That file is the SSOT the Python side validates against (or generates dataclasses from). The convergence mapping:

| Python seam | to `DetectedFace` | from `DetectedFace` |
|---|---|---|
| burns `Box` (normalised xywh) | `box = denormalise(b, image)`, `score = null` | `normalised(result).faces[i].box` as a tuple |
| cutan `Face` | `box = fromXyxy(f.box)`, `score`, `mesh = {topology: 'insightface-106', points: f.landmarks}`; `jaw` derived from topology indices 0–32 | `Face(box=toXyxy(box), jaw=contour(mesh, 'jaw'), landmarks=mesh.points, score)` |
| lookbook `face_box` | `box = fromXyxy`, `score = confidence`, `keypoints = fromKps5(landmarks)` (image-left first → anatomical) | `{x1…y2, confidence: score, landmarks: kps5(keypoints), n_faces: len(faces)}` |
| lookbook `head_pose` | `pose` (already degrees) | identity |
| lookbook ArcFace vector | `embedding {space: 'arcface-buffalo_l', normalized: true}` | identity |

### 5.3 Capabilities as data

```ts
export const BackendInfo = z.object({
  id: z.string(), displayName: z.string(),
  kind: z.enum(['on-device', 'browser-native', 'cloud']),
  modes: z.array(z.enum(['image', 'video', 'live'])),
  emits: z.object({                                  // what the ADAPTER fills, not what the vendor could
    keypoints: z.array(KeypointName),                // e.g. MediaPipe detector: 6 names; Shape Detection: [] (no left/right)
    mesh: z.string().nullable(),                     // topology id or null
    pose: z.boolean(), blendshapes: z.boolean(),
    quality: z.array(z.enum(['blur', 'occluded', 'exposure'])),
    embedding: z.string().nullable(),                // space id
    trackIds: z.boolean(), score: z.boolean(),
  }),
  emitsByMode: z.record(z.string(), z.unknown()).optional(), // per-mode overrides (AWS video: no occlusion)
  accepts: z.record(z.string(), z.object({ native: z.string(), coerce: z.string().optional() }).nullable()), // canonical -> native; null = unsupported
  privacy: z.object({ imageLeavesDevice: z.boolean(), thirdPartyHosts: z.array(z.string()) }), // e.g. ['odml.pa.googleapis.com'] for tasks-vision telemetry
  assets: z.array(z.object({ path: z.string(), bytes: z.number().nullable(), license: z.string() })), // served through the asset resolver
  license: z.object({ code: z.string(), weights: z.string() }),
  cost: z.object({ usdPer1k: z.number().nullable(), seen: z.string(), source: z.string() }).nullable(), // null price = unknown, never 0
  access: z.string().optional(),                     // e.g. "identify/verify: Limited Access, managed customers only"
});
```

Each backend subpath exports its `info` without importing its library. Core ships `ledger.json`: every researched target (cloud and browser), with `implemented` computed from what is registered. `find({ emits: { mesh: 'mediapipe-478' }, kind: 'on-device' })` reads it.

### 5.4 The one path, and the conformance kit

A backend implements three things and nothing else:

```ts
interface FaceBackend<Native = unknown> {
  info: BackendInfo;
  load(ctx: { assets: AssetResolver; signal?: AbortSignal }): Promise<{
    call(image: ImageInput, native: Record<string, unknown>, frame?: { t: number }): Promise<Native>; // the native call only
    normalise(native: Native, image: { width: number; height: number }): DetectedFace[];               // pure: units, names, frames
    close(): void;
  }>;
}
```

Core's `run()` is the only caller. In order, it applies: the privacy gate (`imageLeavesDevice && !allowRemote` → raise), `want` against `emits` for the current mode (raise, naming alternatives via `find`), translation of canonical options through `accepts`, `native` merged untranslated, `call`, `normalise`, the post-filters core can always honour (`minScore`, `maxFaces`), notes, non-enumerable `raw`, and a Zod parse in development and in tests. Sessions are cached per backend and options, with a retry after a failed load (Faceover's `loading = null` pattern [9]). No adapter can skip a step, because an adapter never sees the caller's options.

Core also ships **`checkBackend(backend, fixtures)`**, the TS form of ocracy's `validate_adapter` [4]. On an openly licensed frontal fixture it asserts: every `emits` field is filled; the anatomical invariant `leftEye.x > rightEye.x` holds; on a fixture rotated 15° clockwise, `pose.roll ≈ +15` (or the keypoint-derived roll does); box and keypoints fall in pixels of the image passed in; the score is in [0, 1]. This test is what pins the conventions in §4 per adapter, including AWS's undocumented left/right.

### 5.5 Running modes

| Mode | Verb | Pacing | MediaPipe | Cloud |
|---|---|---|---|---|
| still image | `detect` | — | `runningMode: 'IMAGE'`, `detect()` | sync request (AWS `DetectFaces`, Azure detect, Vision annotate) |
| video file | `track(fileFrames, {pacing: 'every'})` | every frame (or every n-th; decoding is the video-pipeline report's subject) | `'VIDEO'`, `detectForVideo(frame, tMs)` with monotonic timestamps | async job: AWS Start/Get, Google long-running operation; `track()` yields frames once the job is done; job handle (`submit / status / fetch`) as the escape hatch |
| live stream | `track(mediaStream, {pacing: 'latest'})` | the latest frame wins; skipped frames counted | `'VIDEO'` + `requestVideoFrameCallback` (web has no `LIVE_STREAM` [23]); an in-house webcam app's frame pump [10] | not offered (latency and privacy) |

`track` always yields `FaceFrame`s. A backend with its own tracking (Google Video tracks, MediaPipe's VIDEO smoothing) fills `trackId` and declares `emits.trackIds`. Otherwise the `tracker` seam assigns ids (default: greedy IoU matching with a time-to-live, pure and dependency-free).

### 5.6 Lazy loading and packaging

- **Core** (`faces`): Zod schemas, geometry (xywh/xyxy, normalise, NMS/merge, tiling), `run`, the registry, `find`, `ledger.json`, `checkBackend`, the default tracker. Depends only on `zod`.
- **Subpaths** (`package.json` `exports`): `faces/mediapipe` (Face Detector + Face Landmarker), later `faces/human`, `faces/onnx` (SCRFD/YuNet via onnxruntime-web), `faces/shape-detection`, `faces/cloud`. Each is a few KB: `info` plus a `load()` that runs `await import('@mediapipe/tasks-vision')` (through an in-house webcam app's `loadTasksVision` pattern, which installs the telemetry block first [10]). Libraries are `peerDependencies` with `peerDependenciesMeta.optional: true`, except the default's.
- **Default:** when `backend` is omitted, core does `await import('./backends/mediapipe')`. That puts exactly one backend in the reachable graph, as its own lazy chunk, and the wasm and model load on the first `detect`, which is today's behaviour in Faceover's `mediapipeDetector` [9].
- **Assets:** one resolver `(kind: 'runtime' | 'model', path) => url` (an in-house webcam app's `resolveAsset` [10]). The default resolves to the app's own origin (`BASE_URL`), which keeps Faceover's ADR-0001 promise (no CDN, CSP `connect-src 'self'`) [9].

### 5.7 Worker execution

The `executor` seam: `inline` (default, main thread, yielding between calls as Faceover does today) or `worker(url)`, a module worker that hosts backend sessions. The caller transfers an `ImageBitmap` or `VideoFrame`, and the worker posts a `FaceResult` back as JSON. The worker costs v1 only one constraint, which is why it is a seam now: **a backend must be constructible from JSON options** (`mediapipe({ model: 'full-range', delegate: 'CPU' })`, no closures). The worker can then rebuild it from `{id, options}`. An in-house webcam app's `hands.worker.ts` is the existing replacement to point at, and it carries a warning: a classic worker cannot split chunks, so it imports the runtime statically and installs the telemetry block at its top [10].

### 5.8 Escape hatches (three rungs + raw)

1. Canonical options (`want`, `minScore`, `maxFaces`).
2. `native: {...}`, passed untranslated to the selected backend (MediaPipe `minSuppressionThreshold`; a Human config subtree; AWS `Attributes: ['ALL']`), recorded in `notes`.
3. `backend.raw(image, nativeOptions)`: a direct native call with no translation and no normalisation.

Plus `result.raw` and `face.raw`, non-enumerable. Native-only *fields* that are JSON-safe and worth keeping across the boundary (AWS `EyeDirection`, Google likelihoods, Human `gaze`) go into `extras` under their native names.

### 5.9 Where a cloud backend plugs in

`faces/cloud` exports `cloud({ endpoint, provider: 'rekognition' | 'vision' | 'azure' })`, with `kind: 'cloud'` and `privacy.imageLeavesDevice: true`. **Keys never reach the browser**: the endpoint is the maintainer's server (our own server), which holds the credential chain (explicit → per-request → env → store [1]) and calls the vendor. The server's response is already a `FaceResult`, because the server-side adapter is the same normaliser running in Python or Node, against the same JSON Schema. In the browser the backend is therefore an HTTP call plus `FaceResult.parse`. Cost is declared with `usdPer1k: null` when unknown, which forces approval [1]. Azure detection must send `returnFaceId=false` unless identity is wanted, since the id is returned by default and identity features are Limited Access [19][20]. Faceover never registers a cloud backend, and the privacy gate makes an accidental one fail loudly.

### 5.10 Combinators (built from backends; not seams, not a plugin framework)

- `tiled(backend, {levels, overlap, minTile, tileInput})`: Faceover's SAHI-style tiling and merge [9], generalised. It wraps any backend and maps boxes, keypoints and mesh back to the source image.
- `union([a, b], {iou})`: runs several detectors and merges by overlap-over-min (Faceover's `mergeDetections`). This is recall-first, the right posture for de-identification.
- `withTracker(backend, tracker)`.

## 6. v1: the minimum, per the seam rule

**Backends in v1:** the MediaPipe Face Detector (full-range BlazeFace, the default, as ADR-0001 chose) and the MediaPipe Face Landmarker (478-point mesh, matrix → pose, blendshapes). Both come from `@mediapipe/tasks-vision`, which Faceover already depends on, so v1 adds no new dependency. The landmarker exercises the parts of the schema a box-only detector would leave untested (mesh topology, pose in degrees, VIDEO mode). Faceover's AR-lens transforms will need it anyway [9]. A third, test-only `fixture` backend (deterministic faces, like lookbook's mocks [8]) runs `checkBackend` and the e2e tests without wasm. Human, ONNX, Shape Detection and cloud go in the ledger, not the code.

| Seam (one keyword) | v1 default (strongest with no new dependency) | Replacement it is declared for (exists today) |
|---|---|---|
| `backend` | MediaPipe Face Detector, full-range, CPU, self-hosted assets | MediaPipe Face Landmarker (v1); Human [26]; insightface-style ONNX via onnxruntime-web; cloud proxy |
| `tiling` | `tiled()` with Faceover's levels and merge (whole image + 2 finer scales) | `none` for live video (latency); a detector that needs no tiling |
| `tracker` | greedy IoU + TTL (pure) | the backend's own tracks (Google Video [17]); a ByteTrack-style tracker |
| `executor` | inline on the main thread | module worker (an in-house webcam app `hands.worker.ts` [10]) |
| `assets` | same-origin `BASE_URL` resolver | An in-house webcam app's `provideAssetResolver` (CDN or another host) [10] |

`embed`, `compare`, cloud, `quality` and `blendshapes` promotion are post-v1. Their *schema slots* exist now (optional fields), so adding them adds a backend at an existing boundary and changes no caller.

**Faceover migration (when built):** `Detection` → `DetectedFace`. `keypoints[i]` becomes `keypoints.rightEye` and so on. `faceFromDetection` reads `pose?.roll ?? rollFromKeypoints(face)` and converts degrees to radians for its `angle`. `detectFaces(image, {detector})` becomes `detect(image, {backend: tiled(mediapipe())})`. Faceover's `geometry.ts` tiling and merge move to the facade core with their tests.

**One-command test:** `npm test` in the facade repo runs `checkBackend(fixture)` in Node, then `checkBackend(mediapipe())` in a Playwright browser on the openly licensed fixture set (the Solvay 1927 photo is public domain; ADR-0001's 29-of-29 recall becomes a regression test). It fails on any request to an origin outside the asset resolver (Faceover's e2e rule).

## 7. Questions for the maintainer (each with a recommendation)

1. **Canonical left/right: anatomical (recommended) or viewer's frame?** Anatomical matches MediaPipe and COCO and survives mirrored previews. Google and Azure need a swap in their adapters.
2. **Package home and name:** a new `tt/` package (recommended; the reuse is broader than Faceover: an in-house webcam app, lookbook's browser side, reelee previews) vs `src/core/faces/` inside Faceover until a second consumer appears. The architecture-first rule ("extract any independently reusable mechanism") points to the package. Run `short-name-free` before naming it.
3. **Schema SSOT across languages:** Zod → committed JSON Schema (recommended, since the first consumer is TS), or Python dataclasses → generated TS (the falaw twin direction [2]).
4. **Demographic attributes:** never canonical (recommended), and reachable only through `raw`.

## 8. Unverified or open points

- Face++ request and response field names (the docs page renders client-side). Only "106/83 landmarks" and "top 5 largest faces" are confirmed [21].
- AWS landmark left/right frame, and the sign conventions of every vendor's yaw, pitch and roll: the pages give ranges, not signs [14][16][19]. `checkBackend` fixtures settle them.
- Whether `@mediapipe/tasks-vision` 1.2.3 still posts usage telemetry (Faceover's e2e, with a CSP of `connect-src 'self'` and a check for policy violations, saw no third-party request and no violation with 1.2.3 on 2026-11-25) (an in-house webcam app measured 1.1.1 [10]).
- Google Video Intelligence's per-object landmark structure: the field names come from the guide's code samples, not from a type reference [17].
- Human's `face.id`: the type only says "face id" [26]. Whether it is stable across frames is not documented there.
- The TF.js face-detection README sample puts `rightEye` at the larger x [32]. It is either a mirrored image or a viewer-frame convention, which is the same ambiguity as finding 3.

## REFERENCES

1. Maintainer's facade doctrine: `~/.claude/skills/facade-design/SKILL.md` (local).
2. Fleet facade cards and lessons: `~/.claude/skills/facade-design/references/fleet-facades.md` (local).
3. Interface blueprint and audit checklist: `~/.claude/skills/facade-design/references/interface-blueprint.md` (local).
4. ocracy: `$PP/t/ocracy/ocracy/base.py`, `make_backend.py`, `__init__.py`, `backends/tesseract/config.py`, `data/SCHEMA.md` (local).
5. arioso: `$PP/t/arioso/arioso/base.py`, `__init__.py`, `platforms/ace_step/config.py` (local).
6. burns: `$PP/r/burns/burns/content.py` (local).
7. cutan: `$PP/r/cutan/cutan/carve/head.py`, `core.py` (local).
8. lookbook: `$PP/r/lookbook/lookbook/embedders/arcface.py`, `scorers/person.py`, `scorers/identity.py` (local).
9. Faceover: `$PP/tt/faceover/src/core/schema.ts`, `detect.ts`, `geometry.ts`, `docs/adr/0001-in-browser-face-detector.md` (local).
10. An in-house webcam app: a private in-house webcam app, `nodes/domain/frame_timing.ts`, `sources/frame_pump.ts`, `sources/tasks_vision.ts`, `sources/load_tasks_vision.ts`, `sources/vision_telemetry.ts`; `src/nodes/sources/webcam_face.ts`; `packages/lazy/src/index.ts` (local).
11. [AWS Rekognition API: FaceDetail](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_FaceDetail.html)
12. [AWS Rekognition API: Landmark](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_Landmark.html)
13. [AWS Rekognition API: BoundingBox](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_BoundingBox.html)
14. [AWS Rekognition API: Pose](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_Pose.html)
15. [AWS Rekognition API: GetFaceDetection](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceDetection.html)
16. [Google Cloud Vision REST: AnnotateImageResponse (FaceAnnotation, Landmark)](https://docs.cloud.google.com/vision/docs/reference/rest/v1/AnnotateImageResponse)
17. [Google Video Intelligence: Detect faces](https://docs.cloud.google.com/video-intelligence/docs/face-detection)
18. [Google Video Intelligence REST: videos.annotate](https://docs.cloud.google.com/video-intelligence/docs/reference/rest/v1/videos/annotate)
19. [Azure AI Face REST v1.2: Face Detection Operations - Detect](https://learn.microsoft.com/en-us/rest/api/face/face-detection-operations/detect)
20. [Microsoft Learn: Limited Access features of Face](https://learn.microsoft.com/en-us/legal/cognitive-services/computer-vision/limited-access-identity)
21. [Face++: Face Landmarks](https://www.faceplusplus.com/landmarks/)
22. [MediaPipe Face Detector task guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector)
23. [MediaPipe Face Detector guide for web](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js)
24. [MediaPipe tasks-vision JS API: FaceDetector](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.facedetector)
25. [MediaPipe Face Landmarker task guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
26. [Human: src/result.ts](https://github.com/vladmandic/human/blob/main/src/result.ts)
27. [Human: src/config.ts](https://github.com/vladmandic/human/blob/main/src/config.ts)
28. [Human: src/face/angles.ts](https://github.com/vladmandic/human/blob/main/src/face/angles.ts)
29. [WICG: Accelerated Shape Detection in Images (draft)](https://wicg.github.io/shape-detection-api/)
30. [Chrome for Developers: The Shape Detection API](https://developer.chrome.com/docs/capabilities/shape-detection)
31. [Transformers.js: pipelines API](https://huggingface.co/docs/transformers.js/api/pipelines)
32. [TensorFlow.js models: face-detection README](https://github.com/tensorflow/tfjs-models/blob/master/face-detection/README.md)
33. [TensorFlow.js models: face-landmarks-detection README](https://github.com/tensorflow/tfjs-models/blob/master/face-landmarks-detection/README.md)
34. [insightface: utils/face_align.py (ArcFace 5-point template)](https://github.com/deepinsight/insightface/blob/master/python-package/insightface/utils/face_align.py)
35. [COCO: data format (keypoints)](https://cocodataset.org/#format-data)
