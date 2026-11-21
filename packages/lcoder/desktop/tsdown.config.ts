import { defineConfig } from 'tsdown'

/**
 * Sandboxed Electron preloads run as CommonJS even though the package is ESM.
 *
 * Each preload is built as its own single-entry config. A shared multi-entry
 * config emits `contract.ts` as a separate chunk, and sandboxed preloads cannot
 * `require()` a sibling chunk, so each bundle must contain its own copy.
 */
const preload = {
  entry: {
    preload: 'lib/types/preload.js',
  },
  outDir: 'lib',
  format: ['cjs'] as const,
  codeSplitting: false,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
}

const prototypePreviewPreload = {
  ...preload,
  entry: {
    'prototype-preview-preload': 'lib/types/prototype-preview-preload.js',
  },
}

export default defineConfig([preload, prototypePreviewPreload])
