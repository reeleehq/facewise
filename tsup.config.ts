import { defineConfig } from 'tsup';

// Each backend is its own entry, so an app pulls in only what it imports; the core's
// default backend is a dynamic import, split into its own chunk.
export default defineConfig({
  entry: ['src/index.ts', 'src/mediapipe/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  external: ['@mediapipe/tasks-vision', 'zod'],
});
