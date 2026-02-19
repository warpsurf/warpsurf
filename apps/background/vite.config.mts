import { resolve } from 'node:path';
import { defineConfig, type PluginOption } from "vite";
import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets';
import makeManifestPlugin from './utils/plugins/make-manifest-plugin';
import { watchPublicPlugin, watchRebuildPlugin } from '@extension/hmr';
import { isDev, isProduction, isStore, isAPI, isLegacyNavigation, enableSiteSkills, watchOption } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');

const outDir = resolve(rootDir, '..', '..', 'dist');
export default defineConfig({
  resolve: {
    alias: {
      '@root': rootDir,
      '@src': srcDir,
      '@src/background': srcDir,
      '@assets': resolve(srcDir, 'assets'),
      // Ensure storage always resolves to built dist bundle
      '@extension/storage/lib': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'lib'),
      '@extension/storage': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'index.js'),
      '@extension/shared/lib': resolve(rootDir, '..', '..', 'packages', 'shared', 'dist', 'lib'),
      '@extension/shared': resolve(rootDir, '..', '..', 'packages', 'shared', 'dist', 'index.js'),
    },
    conditions: ['browser', 'module', 'import', 'default'],
    mainFields: ['browser', 'module', 'main']
  },
  server: {
    // Restrict CORS to only allow localhost
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true
    },
    host: 'localhost',
    sourcemapIgnoreList: false,
  },
  plugins: [
    libAssetsPlugin({
      outputPath: outDir,
    }) as PluginOption,
    watchPublicPlugin(),
    makeManifestPlugin({ outDir }),
    isDev && watchRebuildPlugin({ reload: true, id: 'chrome-extension-hmr' }),
  ],
  publicDir: resolve(rootDir, 'public'),
  build: {
    lib: {
      formats: ['iife'],
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BackgroundScript',
      fileName: 'background',
    },
    outDir,
    emptyOutDir: false,
    sourcemap: isDev,
    minify: isProduction,
    reportCompressedSize: isProduction,
    watch: watchOption,
    rollupOptions: {
      external: [
        'chrome',
        // 'chromium-bidi/lib/cjs/bidiMapper/BidiMapper.js'
      ],
    },
  },

  esbuild: isStore ? {
    drop: ['console', 'debugger'],
  } : undefined,

  define: {
    'import.meta.env.DEV': isDev,
    'import.meta.env.STORE': isStore,
    'import.meta.env.API': isAPI,
    'process.env.__API__': JSON.stringify(isAPI ? 'true' : 'false'),
    'process.env.__LEGACY_NAVIGATION__': JSON.stringify(isLegacyNavigation ? 'true' : 'false'),
    'process.env.__ENABLE_SITE_SKILLS__': JSON.stringify(enableSiteSkills ? 'true' : 'false'),
  },

  envDir: '../../',
});
