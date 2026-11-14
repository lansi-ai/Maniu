import { defineConfig } from 'tsdown'

/** Sandboxed Electron preloads run as CommonJS even though the package is ESM. */
export default defineConfig([{
  entry: { preload: 'lib/types/preload.js' },
  outDir: 'lib',
  format: ['cjs'],
  codeSplitting: false,
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
}])
