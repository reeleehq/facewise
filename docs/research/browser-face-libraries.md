# Browser-runnable face libraries and models: inventory and API shapes

Research for a browser-side TypeScript facade over "faces in pictures and videos" (detect, landmark, track, later embed and recognise; live camera later), first consumed by Faceover. This extends `$PP/tt/faceover/docs/research/face-detection-in-browser.md` and `$PP/tt/faceover/docs/adr/0001-in-browser-face-detector.md` and does not repeat their conclusions (MediaPipe full-range BlazeFace, tiled with NMS on overlap-over-smaller-box, self-hosted, behind a `detector` seam) [49]. All versions, dates and sizes were checked on 2026-11-25 against npm, GitHub, jsDelivr or the vendor's storage.

## Headline findings

1. **Only MediaPipe tasks-vision is both actively released and covers detect + mesh + blendshapes + pose matrix with clean licences.** It went 1.0.0 on 2026-07-28 and shipped 1.2.3 on 2026-11-11 [4][5]. Its result shapes are the de facto reference the facade should normalise to, with one trap: the detector's box is in **pixels** while its keypoints and the landmarker's mesh are **normalized [0,1]** [1][3].
2. **The TensorFlow.js family is in maintenance.** `@tensorflow/tfjs` last released 4.22.0 on 2024-10-21; `@tensorflow-models/face-detection` and `face-landmarks-detection` last released 2024-10-10 [14][16][18]. `@vladmandic/human` has only rebuild releases since 2024-10 (3.3.6, 2025-08-26) [7][10]; its sibling `@vladmandic/face-api` is archived [12]. Everything built on them (ml5, MindAR, face-api.js forks) inherits that.
3. **The generic-runtime route (onnxruntime-web, transformers.js, LiteRT.js) is where WebGPU lives, but it gives you tensors, not faces.** No transformers.js pipeline does face detection; the Hub has no first-party face detector for it [19][20]. A backend there means writing pre-processing, anchor decoding and NMS per model. LiteRT.js (`@litertjs/core` 2.6.0, 2026-10-22) is the notable newcomer: it runs `.tflite` files (so BlazeFace, including the sparse full-range variant) on WebGPU, WebNN or wasm [23].
4. **The cleanest second detector is YuNet** (MIT code and weights, 232 KB ONNX, a 2026-05 dynamic-shape export, 5 key points, trained for faces of about 10 to 300 px) [24]. It runs through OpenCV.js `FaceDetectorYN`, which is in the JS binding whitelist on both 4.x and 5.x [26][28], or directly on onnxruntime-web.
5. **Weight licences are the main trap, not code licences.** InsightFace (SCRFD, and its recognition packs) is non-commercial research only, and Hub re-uploads relabel it Apache-2.0 [29][30][52]; YOLO-face variants are GPL-3.0 or AGPL-3.0 [34]; WIDER FACE, the training set behind YuNet, SCRFD, RetinaFace, UltraFace, CenterFace and FaceX, is CC BY-NC-ND [36]; ml5's npm metadata says MIT but its repository licence is the custom "ml5.js License" with Code-of-Conduct conditions [39].
6. **The Shape Detection API's `FaceDetector` is still behind a flag** in Chrome ("In Progress") and absent elsewhere [38]. It is the only option with zero download, so it is a candidate opportunistic backend, never a default.

## (1) Comparison table

Sizes are uncompressed bytes of the files a browser fetches (runtime JS + wasm + weights for the face path), from jsDelivr or the model host. "Last release" is the npm publish date of the current `latest`.

### 1a. Libraries with a face API

| Option | Code licence | Weights licence / provenance | Last release | Download (runtime + face weights) | Backends | Worker / OffscreenCanvas | Small / profile faces | Landmarks | Tracking | What it returns |
|---|---|---|---|---|---|---|---|---|---|---|
| **MediaPipe tasks-vision `FaceDetector`** [1][3][4] | Apache-2.0 | Apache-2.0 (Google model card; BlazeFace) | 1.2.3, 2026-11-11 | JS 156 KB + wasm 14.7 MB + short-range 230 KB or full-range 1.08 MB [50] | wasm (XNNPack) CPU, `GPU` delegate = WebGL2; no WebGPU delegate in the types [3] | `canvas?: HTMLCanvasElement \| OffscreenCanvas`; 1.2.0 added Web Worker platform detection [3][5] | short-range is selfie distance; full-range for back-camera photos; small faces need tiling (ADR-0001) | 6 key points | none (stateless per frame, no ids) | `detections[]`: `boundingBox {originX, originY, width, height, angle}` **pixels**; `categories[{score}]`; `keypoints[{x,y}]` **normalized** [1][3] |
| **MediaPipe tasks-vision `FaceLandmarker`** [2][3][6] | Apache-2.0 | Apache-2.0 | 1.2.3, 2026-11-11 | same wasm + `face_landmarker.task` 3.76 MB [50] | as above; blendshapes run on CPU even with GPU delegate since 1.2.0 [5] | as above | built for near faces; uses its own detector, so group photos need the detector first | 478 points (x, y, z) with per-landmark `visibility` and `presence` (presence exposed in 1.1.0) [3][5] | in VIDEO mode it reuses the previous frame; temporal smoothing only when `numFaces` = 1 [2]; no ids | `faceLandmarks[][]` **normalized**, z relative to head centre; `faceBlendshapes` = 52 categories (`_neutral` + 51 ARKit names, no `tongueOut`) [2][6]; `facialTransformationMatrixes` 4x4 canonical-to-face [2] |
| **`@vladmandic/human`** [7][8][9] | MIT | "inherited from the original model source" (MediaPipe BlazeFace/FaceMesh/Iris; HSE FaceRes; others) [9] | 3.3.6, 2025-08-26 (rebuilds only since 3.3.4) [10] | bundle with tfjs 2.07 MB; face defaults: blazeface 0.54 + facemesh 1.48 + iris 2.60 + faceres 6.98 + emotion 0.82 + antispoof 0.85 + liveness 0.59 MB [8] | `cpu`, `wasm`, `webgl`, `humangl`, `webgpu` (tfjs) [8] | "Compatible with WebWorker execution"; accepts `OffscreenCanvas`, `ImageBitmap` [7] | ships `blazeface-back` (full-range) and `blazeface-front` variants, `faceboxes`, `centernet` [8] | 468-point mesh, 478 with iris [7] | frame skipping and caching (`skipFrames`, `skipTime`) plus `human.next()` interpolation; `id` is the array index, not a persistent track id [8] | `FaceResult`: `box`/`boxRaw` `[x,y,w,h]` (pixels / normalized), `mesh`/`meshRaw`, `annotations`, `rotation {angle {roll,yaw,pitch}, matrix 3x3, gaze}`, `embedding` (1024-d from FaceRes), age, gender, emotion, `real`, `live`, `distance` [8] |
| **face-api.js** [11] | MIT | not stated per model | 0.22.2, 2020-03-22 | SSD MobileNetV1 5.6 MB; recognition 6.4 MB; 68-landmarks 357 KB (+ tfjs 1.x) [11] | tfjs 1.x | no | SSD good on small faces (ADR-0001) | 68 points | none | `box {x,y,width,height}`, `score`, `landmarks.positions`, 128-d `descriptor` [11] |
| `@vladmandic/face-api` [12] | MIT | as above | 1.7.15, 2025-02-05; **archived** | bundle 1.33 MB (with tfjs) or 83 KB without | tfjs 4 | Node and browser | as above | 68 | none | as face-api.js |
| `modern-face-api` [13] | MIT | as above | 0.22.5, 2025-09-02 | tfjs-core 4.22 + cpu/webgl backends | tfjs 4 | not documented | as above | 68 | none | as face-api.js |
| **TF.js `@tensorflow-models/face-detection`** [14][15] | Apache-2.0 | Apache-2.0 (MediaPipe BlazeFace) | 1.0.3, 2024-10-10 | tfjs 1.47 MB min JS (+ wasm backend 0.3-0.44 MB if used) [51] | runtime `tfjs` (webgl, wasm, webgpu) or `mediapipe` (legacy `@mediapipe/face_detection`, last 2022) | not documented | `modelType: 'short' \| 'full'`; `full` on tfjs uses the **sparse** full-range model [15] | 6 named key points | none | `box {xMin,xMax,yMin,yMax,width,height}` **pixels**; `keypoints[{x,y,name}]` **pixels** [14] |
| **TF.js `@tensorflow-models/face-landmarks-detection`** [16] | Apache-2.0 | Apache-2.0 | 1.0.6, 2024-10-10 | tfjs + mesh model | as above | not documented | near faces | 468, or 478 with `refineLandmarks` | none | `box` pixels; `keypoints[{x,y,z,name?}]` **pixels**, z relative to head centre [16] |
| **ml5.js `faceMesh`** [39] | npm says MIT; repository `LICENSE.md` is the custom "ml5.js License" with Code-of-Conduct conditions | Apache-2.0 (via TF.js) | 1.4.0, 2026-08-07 | `ml5.min.js` 4.5 MB (bundles tfjs) [51] | tfjs or mediapipe runtime | no | near faces | 468/478 | `detectStart(video, cb)` loop; no ids | TF.js shape plus named contours (`lips`, `faceOval` ...) [39] |
| **jeelizFaceFilter** (`facefilter`) [40] | Apache-2.0 | Apache-2.0 (own nets) | 3.4.3, 2025-07-07 | JS 112 KB + one net 0.25-3.76 MB JSON [40] | WebGL only (needs WebGL2 or float textures) | owns a `<canvas>` WebGL context; `moduleNoDOM` build exists | webcam distance; up to 8 faces | none (expression: mouth opening) | built-in tracking loop, `maxFacesDetected` up to 8 | per frame: `detected` prob, centre `x,y` in **[-1,1], y up**, scale `s`, Euler `rx,ry,rz` (rad), `expressions` [40] |
| **WebAR.rocks.face** [41] | MIT | MIT (nets in `/neuralNets`) | no npm; last commit 2025-11-15 | nets 1.2-4.3 MB JSON | WebGL only | owns a WebGL canvas | webcam distance; up to 8 faces | model-dependent labelled landmarks | built-in tracking with pose stabiliser | `landmarks [[x,y]]` in **[-1,1], y up**, pose, `landmarksLabels` [41] |
| **MindAR face** (`mind-ar`) [42] | MIT | MediaPipe FaceLandmarker | 1.2.5, 2024-01-16 | pulls tasks-vision 0.10.9 **from jsDelivr and Google storage at runtime**, plus tfjs and OpenCV | GPU delegate | no | single face (`numFaces: 1`) | 468/478 via MediaPipe | One-Euro filter on pose | three.js / A-Frame anchors, face geometry [42] |
| **Shape Detection API `FaceDetector`** [37][38] | browser built-in | OS detector | Chrome: behind `#enable-experimental-web-platform-features`, "In Progress" [38] | 0 | OS / platform | `[Exposed=(Window,Worker), SecureContext]` [37] | unknown, platform-dependent | `eye`, `mouth`, `nose` locations, platform-dependent [37][38] | none | `DetectedFace {boundingBox: DOMRectReadOnly, landmarks[{type, locations}]}`; options `maxDetectedFaces`, `fastMode` [37] |
| **FaceX** (newcomer, 2026-04) [43] | Apache-2.0 | own weights: detector on WIDER FACE, landmarks on WFLW, recognition on MS1M, anti-spoof MiniFASNet; shipped AES-256-GCM-encrypted | GitHub only; active (pushed 2026-11-25) | ~17 MB encrypted weights (detector 401 KB) | onnxruntime-web (wasm, WebGPU) | not documented | WIDER-trained FCOS detector | 98 points + 576-point 3D mesh | tracker in its native stack | detect, landmarks, mesh, embedding, spoof score [43] |
| facenet-js [44] | MIT | BlazeFace + FaceNet | GitHub only, 9 stars | not measured | WebGL / WebGPU (tfjs) | not documented | BlazeFace | 6 | none | box, embedding [44] |

### 1b. Generic runtimes (a face backend = runtime + model + your own decoding)

| Runtime | Licence | Last release | Size | Backends | Input / output | Notes |
|---|---|---|---|---|---|---|
| **onnxruntime-web** [21][22] | MIT | 1.31.1, 2026-10-26 | CPU wasm 14.8 MB; WebGPU (JSEP/asyncify) wasm 28.7-29.5 MB; JSPI 17.9 MB [51] | `wasm`, `webgpu`, `webgl`, `webnn`; only wasm has full op coverage [21] | tensors in, tensors out | runs every ONNX face model below |
| **transformers.js** (`@huggingface/transformers`) [19][20] | Apache-2.0 | 4.3.2, 2026-10-27 | JS 588 KB + onnxruntime-web | `device: 'webgpu'` or wasm [19] | pipelines; no face-detection pipeline or first-party face model on the Hub (only face parsing, emotion) | useful later for embeddings or segmentation, not for detection |
| **LiteRT.js** (`@litertjs/core`) [23] | Apache-2.0 | 2.6.0, 2026-10-22 | wasm about 11 MB [51] | `accelerator: 'webgpu' \| 'webnn' \| 'wasm'`; unsupported GPU ops fall back to CPU [23] | tensors; TF.js interop | runs MediaPipe's `.tflite` face models on WebGPU without the MediaPipe graph |
| **OpenCV.js** (`@techstark/opencv-js`) [26][27][28] | Apache-2.0 | 5.0.0-release.1, 2026-06-24 (OpenCV 5.1.0 released 2026-11-06) | `opencv.js` 13.3 MB single file | wasm | `cv.Mat`; `FaceDetectorYN.create(model, config, inputSize, score=0.9, nms=0.3, topK=5000)`, `detect(img, faces)` returns an N x 15 Mat: `x,y,w,h`, 5 key points (right eye, left eye, nose tip, right mouth corner, left mouth corner), score, in **pixels** [28] | 5.x JS bindings drop `CascadeClassifier`; `FaceRecognizerSF` is not in the JS whitelist on 4.x or 5.x [26] |

### 1c. Face models usable on those runtimes

| Model | Code licence | Weights licence / training data | Size | WIDER FACE val (Easy / Medium / Hard) | Key points | Notes |
|---|---|---|---|---|---|---|
| **YuNet** (2023mar, 2026may dynamic) [24][25] | MIT | MIT; WIDER FACE | 232 KB fp32, 100 KB int8 | 0.884 / 0.866 / 0.750 (zoo eval) | 5 | "faces of pixels between around 10x10 to 300x300"; OpenCV `FaceDetectorYN` decodes it |
| **SCRFD** 500M / 2.5G / 10G (_KPS) [29] | Apache-2.0 (mmdet code) | **non-commercial research only** (InsightFace README); WIDER FACE | 0.57-4.23 M params | 500M: 90.6 / 88.1 / 68.5; 10G: 95.2 / 93.9 / 83.1 | 5 with `_KPS` | Hub re-uploads tagged Apache-2.0 do not change the source licence [30][52] |
| **RetinaFace** MobileNet-0.25 [32] | MIT (biubug6) | MIT repo; WIDER FACE | 1.7 MB | 90.7 / 88.2 / 73.8 (original scale) | 5 | reference architecture for the 5-point convention |
| **UltraFace** RFB-320 / slim-320 [31] | MIT | MIT; WIDER FACE | 1.05-1.59 MB ONNX | RFB at 640: 0.855 / 0.822 / 0.579; at 320 Hard 0.438 | none | weakest on small faces |
| **CenterFace** [33] | MIT | MIT; WIDER FACE | 7.3-7.5 MB ONNX | 0.935 / 0.924 / 0.875 | 5 | best Hard score of the permissive set; repository idle since 2021 |
| **YOLO-face** (yolov5-face, yolov8-face, akanametov/yolo-face, HF YOLOv8-Face) [34] | **GPL-3.0** | **GPL-3.0 / AGPL-3.0** (Ultralytics base is AGPL-3.0) | varies | high | 5 | copyleft reaches a shipped web app; avoid |
| **BlazeFace ONNX** (PINTO model zoo) [35] | MIT (zoo) | Apache-2.0 (Google) | about 0.2-1 MB | not published on WIDER | 6 | same model as MediaPipe, decoded yourself |
| **SFace** recognizer [24] | Apache-2.0 | Apache-2.0 (opencv_zoo) | MobileFaceNet | n/a (recognition) | n/a | a permissive embedding model for later |

## (2) What they have in common

### Inputs

| Input | MediaPipe [3] | Human [7][8] | TF.js models [17] | face-api.js [11] | Shape Detection [37] | OpenCV.js / ORT / LiteRT |
|---|---|---|---|---|---|---|
| `HTMLImageElement` | yes | yes | yes | yes | yes | via canvas |
| `HTMLCanvasElement` | yes | yes | yes | yes | yes | yes (OpenCV `imread`) |
| `OffscreenCanvas` | yes | yes | no | no | yes | via `ImageData` |
| `HTMLVideoElement` | yes | yes | yes | yes | yes | via canvas |
| `ImageBitmap` | yes | yes | yes | no | yes | via canvas |
| `ImageData` | yes | yes | yes | no | yes | yes |
| `VideoFrame` (WebCodecs) | yes (`TexImageSource`) | no | no | no | yes (`ImageBitmapSource`) | via canvas |
| Tensor | no | yes | `Tensor3D` | yes | no | native |

- **Union:** image, canvas, OffscreenCanvas, video element, ImageBitmap, ImageData, VideoFrame, tensor, Blob (Shape Detection accepts any `ImageBitmapSource`, which includes `Blob`).
- **Intersection of everything:** a pixel buffer you draw yourself. Practically, **`ImageBitmap`/canvas** is accepted by every high-level library except face-api.js, and `ImageData` is the universal fallback for the tensor runtimes. A facade should accept the union and normalise to `ImageBitmap` (transferable to a worker) or `VideoFrame` internally.

### Running modes

- **IMAGE**: stateless, one call per still (MediaPipe `detect`, Human `detect`, TF.js `estimateFaces`, Shape Detection `detect`) [1][3].
- **VIDEO**: ordered frames with a monotonically increasing timestamp, synchronous, state carried between frames (MediaPipe `detectForVideo(frame, timestampMs)`) [1][2]. Human gets the same effect through `skipFrames` / `skipTime` caching [8].
- **LIVE_STREAM**: asynchronous, callback-delivered, drops frames when busy. It exists on Android, iOS and Python; on the Web, Google's own guides use VIDEO plus `requestAnimationFrame` [1][2]. ml5 `detectStart`, Jeeliz and WebAR.rocks own the loop themselves [39][40][41].
- The facade's live mode should therefore be its own loop (frame source, drop-if-busy, timestamp) over a backend's VIDEO call, not a backend feature.

### Options

| Concept | MediaPipe | Human | TF.js | face-api.js | Shape Detection | OpenCV YuNet | Jeeliz / WebAR.rocks |
|---|---|---|---|---|---|---|---|
| min score | `minDetectionConfidence` 0.5; landmarker `minFaceDetectionConfidence`, `minFacePresenceConfidence`, `minTrackingConfidence` [1][2] | `minConfidence` | (internal) | `minConfidence` / `scoreThreshold` | none | `score_threshold` 0.9 | none |
| max faces | landmarker `numFaces` (default 1) | `maxDetected` | `maxFaces` (default 1) | `maxResults` (100) | `maxDetectedFaces` | `top_k` | `maxFacesDetected` (max 8) |
| NMS threshold | `minSuppressionThreshold` 0.3 | `iouThreshold` | none | none | none | `nms_threshold` 0.3 | none |
| speed/accuracy | model choice | model choice | `modelType` | `inputSize` | `fastMode` | input size | net choice |
| mirroring | blendshape Left/Right are the subject's; mirrored input inverts them [2] | n/a | `flipHorizontal` | n/a | n/a | n/a | n/a |
| ROI / rotation | `regionOfInterest` (normalized), `rotationDegrees` (multiples of 90) [3] | `rotation` correction | none | none | none | none | none |
| outputs on/off | `outputFaceBlendshapes`, `outputFacialTransformationMatrixes` | per-module `enabled` | none | chained `.withFaceLandmarks()` | none | none | none |

**Intersection:** a score threshold and a face cap. **Union** adds NMS threshold, speed hint, ROI, rotation, mirroring and output toggles.

### Outputs

- **Intersection (every option):** a box and a score per face (Shape Detection gives no score [37]).
- **Union:** box; score; sparse key points (5 or 6, named); dense landmarks (68, 98, 468, 478, 576 points), with z, visibility and presence; named contours; head pose as Euler angles (Human `roll/yaw/pitch`, Jeeliz `rx,ry,rz`) or matrix (MediaPipe 4x4, Human 3x3); blendshapes (MediaPipe 52); gaze; embedding (128-d face-api.js, 1024-d Human FaceRes, 512-d FaceX); attributes (age, gender, emotion); anti-spoof and liveness scores; an id (index only, nowhere a persistent track id).

### Coordinate conventions (the part a facade must own)

| Source | Box format | Units | Origin, y direction |
|---|---|---|---|
| MediaPipe detector [3] | `{originX, originY, width, height, angle}` | **pixels** (integers) | top-left, y down |
| MediaPipe key points and landmarks [3] | `{x, y[, z]}` | **normalized [0,1]** by image width and height | top-left, y down |
| Human [8] | `[x, y, w, h]` arrays, `box` and `boxRaw` | pixels and normalized | top-left, y down |
| TF.js [14][16] | `{xMin, xMax, yMin, yMax, width, height}`; key points `{x, y, z?, name?}` | pixels | top-left, y down |
| face-api.js [11] | `{x, y, width, height}` | pixels | top-left, y down |
| Shape Detection [37] | `DOMRectReadOnly` | pixels of the source | top-left, y down |
| OpenCV `FaceDetectorYN` [28] | row of 15 floats `x, y, w, h, ...` | pixels | top-left, y down |
| ORT/LiteRT detectors | usually `xyxy` or centre-size at model input size, after letterbox | model input pixels | top-left, y down |
| Jeeliz, WebAR.rocks [40][41] | centre `x, y` + scale `s` (square), landmarks | **[-1,1]** viewport | centre, **y up** |

Two further traps: **z** in MediaPipe and TF.js is "roughly the same scale as x", relative to the head centre, smaller is closer [2][16]; and **Left/Right** names refer to the subject, not the viewer [2]. A facade type that stores normalized top-left y-down coordinates plus the source's pixel size, and converts on output, absorbs every row of this table.

## (3) Verdicts

| Option | Verdict | Reason |
|---|---|---|
| MediaPipe tasks-vision `FaceDetector` | **depend** (already, ADR-0001) | the only actively released, Apache-2.0 detector with a full-range model; make it the facade's default `detect` backend |
| MediaPipe tasks-vision `FaceLandmarker` | **depend** (as the `landmark` backend) | 478 points, blendshapes and pose matrix in one call, same wasm already shipped; pair it with the detector for group photos, since it is tuned for near faces |
| LiteRT.js | **study**, then wrap as a backend | the WebGPU route for the same Google `.tflite` models (including sparse full-range BlazeFace); only worth it if WebGL2 or wasm speed proves insufficient for live video |
| onnxruntime-web + **YuNet** | **wrap as a backend** | permissive weights, 232 KB, strong small-face recall in its 10-300 px range; a true second opinion (different architecture and training set) for recall ensembling in Faceover |
| OpenCV.js `FaceDetectorYN` | **study** | decodes YuNet for you, but 13.3 MB for one function; port its decoding to an ORT backend instead |
| transformers.js | **study** (for later embeddings and segmentation) | no face detector; WebGPU plumbing over ORT is the value |
| `@vladmandic/human` | **study** | the richest single API (pose angles, gaze, embedding, liveness), a good model for the facade's output type; no feature releases since 2024-10 and a tfjs runtime in maintenance |
| TF.js face-detection / face-landmarks-detection | **avoid** | same models as MediaPipe on a frozen runtime; the `mediapipe` runtime path uses the 2021-2022 legacy solutions |
| face-api.js and forks | **avoid** | 2020 code; maintained fork archived; 68-point landmarks only |
| ml5.js faceMesh | **avoid** | wrapper over TF.js; non-standard repository licence |
| jeelizFaceFilter, WebAR.rocks.face | **study** | permissive, live-AR oriented, own the canvas and the loop; useful prior art for the live-camera surface (pose stabiliser, `[-1,1]` viewport model), not a still-photo backend |
| MindAR face | **avoid** (study its One-Euro filter and face geometry) | a single-face wrapper over an old MediaPipe that loads from CDNs, which Faceover's CSP forbids |
| Shape Detection API | **wrap as an opportunistic backend** | zero download, worker-exposed, but flagged in Chrome only and platform-dependent; feature-detect and never default |
| FaceX | **study** | interesting full-stack newcomer on ORT-web, but encrypted weights and WIDER / WFLW / MS1M training data are provenance flags |
| SCRFD, YOLO-face | **avoid** | non-commercial (InsightFace) or GPL/AGPL weights |
| RetinaFace-mnet, UltraFace, CenterFace | **study** | MIT, but WIDER-trained like YuNet and without YuNet's maintenance; CenterFace's Hard score is the one to beat if YuNet disappoints |
| SFace (opencv_zoo) | **study** for the later `embed` capability | Apache-2.0 recognizer runnable on ORT-web |

**Licence note common to the WIDER-trained models.** WIDER FACE is CC BY-NC-ND [36]. Whether trained weights inherit a dataset's non-commercial term is legally unsettled; the model licences (MIT for YuNet, RetinaFace, UltraFace, CenterFace) say nothing about it. Record it in the model's provenance file, as Faceover's `public/models/SOURCES.md` already does for BlazeFace.

## (4) Standard terminology

- **Face detection**: locating faces as bounding boxes with a confidence score, often with a few **key points** (5-point: eyes, nose tip, mouth corners, as in RetinaFace, YuNet, SCRFD [28][32]; 6-point: eyes, nose tip, mouth centre, ear tragions, as in BlazeFace [1][45]).
- **Face landmark detection / face alignment**: estimating many points on the face (68 in the iBUG 300-W convention used by face-api.js, 98 in WFLW, 468/478 in MediaPipe's **face mesh**). "Landmarks" is the term for the dense set; "keypoints" for the sparse set returned by a detector.
- **Face mesh** and **canonical face model**: a fixed-topology 3D surface; the **facial transformation matrix** maps canonical coordinates to the detected face [2].
- **Head pose**: rotation as **yaw, pitch, roll** (Euler angles) or a rotation matrix; **gaze** is eye direction.
- **Blendshapes** (blend shape coefficients): per-expression weights in [0,1] using Apple ARKit's names (`jawOpen`, `eyeBlinkLeft` ...) [2][6][48].
- **Tracking**: following faces across frames. **Tracking-by-detection** re-runs a detector and associates boxes; **landmark tracking** (MediaPipe VIDEO mode) seeds the next frame's region from the current landmarks. A **track id** is the persistent identity of a track; none of the libraries above provides one.
- **Face recognition** (ISO/IEC 2382-37 vocabulary [46]): **verification** (1:1, "is this the same person?") versus **identification** (1:N, "who is this?"); the model's output is a **face embedding** (also descriptor, template, feature vector), compared by cosine similarity or Euclidean distance after **alignment** to a standard crop.
- **Presentation attack detection (PAD)**, informally **anti-spoofing** or **liveness detection**: deciding whether the face is live or a photo, screen or mask (ISO/IEC 30107-1 [47]).
- **Face de-identification / anonymization**: Faceover's purpose, defined in the earlier report.
- **Running mode** (MediaPipe): IMAGE, VIDEO, LIVE_STREAM [1]. **Delegate** (MediaPipe), **backend** (TF.js, Human), **execution provider** (ONNX Runtime), **accelerator** (LiteRT.js) all name the same thing: where inference runs.
- **NMS**, **IoU**, **anchors**, **letterboxing**: post- and pre-processing terms the generic-runtime backends must implement themselves.
- **WIDER FACE Easy / Medium / Hard**: the standard detection benchmark splits; Hard is dominated by small, occluded and profile faces, so it is the proxy for Faceover's group-photo recall [36].

## REFERENCES

1. Google. [Face detection guide for Web (MediaPipe Tasks)](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js). Accessed 2026-11-25.
2. Google. [Face landmark detection guide for Web (MediaPipe Tasks)](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js). Accessed 2026-11-25.
3. Google. [@mediapipe/tasks-vision 1.2.3 type definitions, vision.d.ts](https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision.d.ts) (`BoundingBox`, `Detection`, `NormalizedLandmark`, `VisionTaskOptions.canvas`, `ImageProcessingOptions`, `delegate: "CPU" | "GPU"`).
4. Google. [@mediapipe/tasks-vision on npm](https://www.npmjs.com/package/@mediapipe/tasks-vision). 1.2.3 published 2026-11-11; 1.0.0 published 2026-07-28; Apache-2.0.
5. Google. [MediaPipe releases](https://github.com/google-ai-edge/mediapipe/releases): [v1.1.0](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.1.0) (per-landmark presence on Web), [v1.2.0](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.2.0) (Web Worker platform detection; blendshapes on CPU with GPU delegate), [v1.2.2](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.2.2) (non-SIMD wasm removed), [v1.2.3](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.2.3).
6. Google. [face_blendshapes_graph.cc (blendshape names)](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_landmarker/face_blendshapes_graph.cc).
7. Mandic V. [Human](https://github.com/vladmandic/human). GitHub; MIT. README sections "Inputs" and features.
8. Mandic V. [@vladmandic/human 3.3.6 types/human.d.ts](https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/types/human.d.ts) (`FaceResult`, `BackendEnum`, `Input`, `FaceDetectorConfig`) and [models.json](https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/models.json); `src/face/face.ts` sets `id: i`.
9. Mandic V. [Human wiki: Models](https://github.com/vladmandic/human/wiki/Models).
10. Mandic V. [Human CHANGELOG](https://github.com/vladmandic/human/blob/main/CHANGELOG.md) and [@vladmandic/human on npm](https://www.npmjs.com/package/@vladmandic/human).
11. Mühler V. [face-api.js](https://github.com/justadudewhohacks/face-api.js) (README, `weights/`); [npm 0.22.2](https://www.npmjs.com/package/face-api.js).
12. Mandic V. [@vladmandic/face-api](https://github.com/vladmandic/face-api). GitHub, archived; npm 1.7.15.
13. [modern-face-api on npm](https://www.npmjs.com/package/modern-face-api). 0.22.5, 2025-09-02.
14. TensorFlow. [face-detection README](https://github.com/tensorflow/tfjs-models/tree/master/face-detection); [npm 1.0.3](https://www.npmjs.com/package/@tensorflow-models/face-detection).
15. TensorFlow. [MediaPipeFaceDetector (tfjs runtime) README](https://github.com/tensorflow/tfjs-models/blob/master/face-detection/src/mediapipe/README.md).
16. TensorFlow. [face-landmarks-detection README](https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection); [npm 1.0.6](https://www.npmjs.com/package/@tensorflow-models/face-landmarks-detection).
17. TensorFlow. [common_interfaces.ts (`PixelInput`)](https://github.com/tensorflow/tfjs-models/blob/master/shared/calculators/interfaces/common_interfaces.ts).
18. TensorFlow. [@tensorflow/tfjs on npm](https://www.npmjs.com/package/@tensorflow/tfjs). 4.22.0, 2024-10-21.
19. Hugging Face. [Running models on WebGPU (transformers.js)](https://huggingface.co/docs/transformers.js/guides/webgpu).
20. Hugging Face. [@huggingface/transformers on npm](https://www.npmjs.com/package/@huggingface/transformers). 4.3.2, 2026-10-27; Hub search for transformers.js face models, 2026-11-25.
21. Microsoft. [ONNX Runtime Web tutorial](https://onnxruntime.ai/docs/tutorials/web/).
22. Microsoft. [onnxruntime-web on npm](https://www.npmjs.com/package/onnxruntime-web). 1.31.1, 2026-10-26; MIT.
23. Google. [LiteRT for Web (LiteRT.js)](https://developers.google.com/edge/litert/web); [@litertjs/core on npm](https://www.npmjs.com/package/@litertjs/core), 2.6.0, 2026-10-22.
24. OpenCV. [opencv_zoo: face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) (README, MIT LICENSE, LFS sizes) and [face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface).
25. Wu W, Peng H, Yu S. [YuNet: A Tiny Millisecond-level Face Detector](https://link.springer.com/article/10.1007/s11633-023-1423-y). Mach Intell Res. 2023.
26. OpenCV. [opencv_js.config.py, 5.x](https://github.com/opencv/opencv/blob/5.x/platforms/js/opencv_js.config.py) and [4.x](https://github.com/opencv/opencv/blob/4.x/platforms/js/opencv_js.config.py) (JS binding whitelist).
27. TechStark. [opencv-js](https://github.com/TechStark/opencv-js); [npm @techstark/opencv-js](https://www.npmjs.com/package/@techstark/opencv-js).
28. OpenCV. [objdetect/face.hpp, `FaceDetectorYN`](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/include/opencv2/objdetect/face.hpp).
29. Guo J, Deng J, et al. [SCRFD (InsightFace detection/scrfd)](https://github.com/deepinsight/insightface/tree/master/detection/scrfd).
30. DeepInsight. [InsightFace README, License section](https://github.com/deepinsight/insightface#license).
31. Linzaer. [Ultra-Light-Fast-Generic-Face-Detector-1MB](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB).
32. biubug6. [Pytorch_Retinaface](https://github.com/biubug6/Pytorch_Retinaface); Deng J, Guo J, et al. [RetinaFace](https://arxiv.org/abs/1905.00641). arXiv:1905.00641; 2019.
33. Star-Clouds. [CenterFace](https://github.com/Star-Clouds/CenterFace).
34. [deepcam-cn/yolov5-face](https://github.com/deepcam-cn/yolov5-face) (GPL-3.0); [derronqi/yolov8-face](https://github.com/derronqi/yolov8-face) (GPL-3.0); [akanametov/yolo-face](https://github.com/akanametov/yolo-face) (GPL-3.0); [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics) (AGPL-3.0); [arnabdhar/YOLOv8-Face-Detection](https://hf.co/arnabdhar/YOLOv8-Face-Detection) (AGPL-3.0).
35. Hyodo K. [PINTO_model_zoo](https://github.com/PINTO0309/PINTO_model_zoo). GitHub; MIT.
36. Yang S, Luo P, Loy CC, Tang X. [WIDER FACE: A Face Detection Benchmark](http://shuoyang1213.me/WIDERFACE/). Licence: CC BY-NC-ND.
37. WICG. [Accelerated Shape Detection in Images (spec)](https://wicg.github.io/shape-detection-api/).
38. Chrome for Developers. [The Shape Detection API: a picture is worth a thousand words, faces, and barcodes](https://developer.chrome.com/docs/capabilities/shape-detection).
39. ml5.js. [FaceMesh source](https://github.com/ml5js/ml5-next-gen/blob/main/src/FaceMesh/index.js); [repository LICENSE.md](https://github.com/ml5js/ml5-next-gen/blob/main/LICENSE.md); [npm ml5 1.4.0](https://www.npmjs.com/package/ml5).
40. Jeeliz. [jeelizFaceFilter](https://github.com/jeeliz/jeelizFaceFilter) (README: detection state, `maxFacesDetected`, licence); [npm facefilter 3.4.3](https://www.npmjs.com/package/facefilter).
41. WebAR.rocks. [WebAR.rocks.face](https://github.com/WebAR-rocks/WebAR.rocks.face) (README, LICENSE).
42. Yuen HK. [MindAR](https://github.com/hiukim/mind-ar-js); [face-mesh-helper.js](https://github.com/hiukim/mind-ar-js/blob/master/src/face-target/face-mesh-helper.js); [npm mind-ar 1.2.5](https://www.npmjs.com/package/mind-ar).
43. FaceX. [facex-engine/facex](https://github.com/facex-engine/facex). GitHub; Apache-2.0; created 2026-04-25.
44. Cezar C. [facenet-js](https://github.com/cezarc1/facenet-js). GitHub; MIT.
45. Bazarevsky V, et al. [BlazeFace: Sub-millisecond Neural Face Detection on Mobile GPUs](https://arxiv.org/abs/1907.05047). arXiv:1907.05047; 2019.
46. ISO/IEC. [ISO/IEC 2382-37:2022 Information technology, Vocabulary, Part 37: Biometrics](https://www.iso.org/standard/73514.html).
47. ISO/IEC. [ISO/IEC 30107-1:2023 Biometric presentation attack detection, Part 1: Framework](https://www.iso.org/standard/83828.html).
48. Apple. [ARFaceAnchor.BlendShapeLocation](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation).
49. Faceover. `$PP/tt/faceover/docs/research/face-detection-in-browser.md` and `$PP/tt/faceover/docs/adr/0001-in-browser-face-detector.md` (internal).
50. Google MediaPipe model storage, HTTP `Content-Length` on 2026-11-25: [blaze_face_short_range.tflite](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite) 229,746 B; [blaze_face_full_range.tflite](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite) 1,083,786 B; [face_landmarker.task](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) 3,758,596 B. tasks-vision wasm 14,665,716 B (installed package).
51. jsDelivr package file listings, 2026-11-25: [onnxruntime-web 1.31.1](https://www.jsdelivr.com/package/npm/onnxruntime-web), [@litertjs/core 2.6.0](https://www.jsdelivr.com/package/npm/@litertjs/core), [@tensorflow/tfjs 4.22.0](https://www.jsdelivr.com/package/npm/@tensorflow/tfjs), [@tensorflow/tfjs-backend-wasm 4.22.0](https://www.jsdelivr.com/package/npm/@tensorflow/tfjs-backend-wasm), [ml5 1.4.0](https://www.jsdelivr.com/package/npm/ml5), [@vladmandic/face-api 1.7.15](https://www.jsdelivr.com/package/npm/@vladmandic/face-api), [@huggingface/transformers 4.3.2](https://www.jsdelivr.com/package/npm/@huggingface/transformers).
52. RuteNL. [SCRFD-face-detection-ONNX](https://hf.co/RuteNL/SCRFD-face-detection-ONNX). Hugging Face; tagged Apache-2.0.
