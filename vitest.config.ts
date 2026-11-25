import { defineConfig } from 'vitest/config';
// Unit tests only; the browser conformance specs in e2e/ run under Playwright.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
