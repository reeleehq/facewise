# facewise — map for agents building it

Seams (v1 default → replacement): backend = MediaPipe detector tiled → landmarker (shipped), YuNet, cloud proxy; assets = page origin → CDN; tracker (video, next) = greedy IoU+TTL → ByteTrack; executor (next) = inline → worker. Surfaces: TS library only.

- `src/schema.ts` is the SSOT (`faces/1`). Change it → `npm run schema` and commit `schemas/`.
- `src/detect.ts` is the one path; adapters only `call` and `normalise`. Never enforce options inside an adapter.
- Each backend = `src/<name>/info.ts` (data, no library import) + `src/<name>/index.ts` (lazy `import()` of the library) + a tsup entry + a `package.json` export + a conformance run in `e2e/`.
- Conventions are pinned by `e2e/conformance.spec.ts` (subject's left/right, roll sign, 29/29 Solvay recall). Run `npm test && npm run test:e2e` before landing.
- Research and decisions: `docs/research/`, `docs/adr/`. Photos of people never in the repo (samples in `~/.local/share/faceover/samples/`).
- Consumers: thorwhalen/faceover (photos, first), reelee video (next).
