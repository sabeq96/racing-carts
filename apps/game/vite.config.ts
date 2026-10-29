import { defineConfig } from 'vite';

// The Samsung TV (Tizen 6.5) runs roughly Chromium 85. Chrome 85 itself supports logical
// assignment (??=, ||=, &&=), but the minifier would emit them for a bare 'chrome85' target and a
// slightly older TV runtime would then fail to parse the bundle. Adding 'es2020' keeps them out.
const TV_TARGET = ['chrome85', 'es2020'];

export default defineConfig({
  base: './',
  build: {
    // Vite 8 feeds this into Rolldown's oxc transform for app code and dependencies alike.
    target: TV_TARGET,
  },
  optimizeDeps: {
    // Vite 8 dev dependency pre-bundling (Rolldown) defaults to "baseline-widely-available";
    // pin it to the TV as well. (`esbuildOptions.target` is deprecated and ignored.)
    rolldownOptions: {
      transform: { target: TV_TARGET },
    },
  },
  server: { host: true },
  preview: { host: true },
});
