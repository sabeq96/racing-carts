import { defineConfig, type Plugin } from 'vite';

// The Samsung TV (Tizen 6.5) runs roughly Chromium 85. Chrome 85 itself supports logical
// assignment (??=, ||=, &&=), but the minifier would emit them for a bare 'chrome85' target and a
// slightly older TV runtime would then fail to parse the bundle. Adding 'es2020' keeps them out.
const TV_TARGET = ['chrome85', 'es2020'];

/**
 * A packaged Tizen app is served from file:// (or an opaque app origin), where module scripts and
 * `crossorigin` requests can be blocked by CORS and leave a black screen. The bundle is a single
 * IIFE, so turn the entry tag into a plain deferred classic script and drop modulepreload and
 * crossorigin from every tag.
 */
function classicScriptPlugin(): Plugin {
  return {
    name: 'rc-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>\s*/gi, '')
          .replace(/<script\b([^>]*)>/gi, (_m, attrs: string) => {
            const cleaned = attrs
              .replace(/\s+type=["']module["']/gi, '')
              .replace(/\s+crossorigin(=["'][^"']*["'])?/gi, '');
            return /\bdefer\b/.test(cleaned) ? `<script${cleaned}>` : `<script defer${cleaned}>`;
          })
          .replace(/(<link\b[^>]*?)\s+crossorigin(=["'][^"']*["'])?([^>]*>)/gi, '$1$3');
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [classicScriptPlugin()],
  build: {
    // Vite 8 feeds this into Rolldown's oxc transform for app code and dependencies alike.
    target: TV_TARGET,
    modulePreload: false,
    rolldownOptions: {
      output: {
        // One self-contained classic script: no ES module syntax, no code splitting.
        format: 'iife',
        codeSplitting: false,
      },
    },
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
