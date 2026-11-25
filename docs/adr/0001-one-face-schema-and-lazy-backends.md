# ADR-0001: One normalised face schema, backends as lazy values

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Face tools disagree on everything but the idea: boxes as pixels or ratios, `xywh` or `xyxy`, scores 0–1 or 0–100, angles in radians or degrees, and "left eye" from the subject's side or the viewer's. MediaPipe even mixes pixels (the box) and ratios (the key points) in one result. Code that consumes faces (cover them, crop them, frame them in a camera move) should not care which tool found them, and an app should only download the tool it uses. Research: `docs/research/face-facade-synthesis.md` and the three reports beside it.

## Decision

1. **One schema, `faces/1`, in Zod**, exported as JSON Schema for other languages. Coordinates normalised to the image passed in (top-left, unclamped) with the image size carried alongside; scores in [0, 1] or `null`; the **subject's** left and right; degrees, roll > 0 clockwise as displayed; seconds of media time. Normalised because video detects at one resolution, renders at another and tiles at a third. Demographic attributes are never canonical.
2. **Backends are values**, each a subpath export that imports its library on first use (`facewise/mediapipe`); the core depends only on `zod`. The default backend is itself a dynamic import.
3. **Capabilities are data** (`BackendInfo`: what the adapter fills, per mode; privacy; licences of code and weights). The one path (`detect`) enforces them: a wanted output that is not given raises; a backend that sends the image away needs `allowRemote`.
4. **Conventions are tested, not trusted**: `checkBackend` runs a backend on fixtures and fails on a swapped left/right, a wrong roll sign, unnormalised boxes or an undeclared field. On 2026-11-25 both MediaPipe backends passed in WebKit and Chromium: subject's left/right as documented, and the landmarker's matrix gives roll +17° to +19° on a face turned 15° clockwise once its y-up frame is flipped.

## Seams

| Seam | v1 default | Replacement in view |
|---|---|---|
| `backend` | MediaPipe detector, full-range, tiled | landmarker (shipped); YuNet on onnxruntime-web; a cloud proxy |
| `tiled` options | whole image + 2 finer scales, merge by overlap-over-min | none (live video) |
| `assets` | the page's own origin | a CDN or another host |
| tracker (video, next) | greedy IoU with a time-to-live | ByteTrack-style; a backend's own tracks |
| executor (next) | inline, yielding between tiles | a module worker |

NOT seams: merge thresholds, the keypoint index table of the 478-point mesh, the video codec (MP4/H.264 plays everywhere).

## Consequences

- Adding a backend is one subpath with an `info` object and a `load`; no caller changes.
- Python producers (burns, cutan, lookbook) can converge on `schemas/faces-1.schema.json`.
- A consumer that needs pixels calls `toPixels`; Faceover keeps drawing in pixels.
