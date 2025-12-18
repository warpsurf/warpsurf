import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');

export default withPageConfig({
  resolve: {
    alias: {
      '@src': srcDir,
      // Force storage to use built dist to avoid source/dist shape mismatches in runtime
      // Put '/lib' before root alias so nested imports resolve correctly
      '@extension/storage/lib': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'lib'),
      '@extension/storage': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'index.js'),
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'settings'),
  },
});
