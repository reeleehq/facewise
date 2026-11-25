/** Browser conformance of the MediaPipe backends, on WebKit (iPhone) and Chromium (Pixel). */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  use: { baseURL: 'http://localhost:4321/' },
  webServer: {
    command: 'node bin/facewise-assets.mjs e2e/harness/public blaze_face_full_range.tflite face_landmarker.task && npx vite --config e2e/vite.config.ts',
    url: 'http://localhost:4321/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
