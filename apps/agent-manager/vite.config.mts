import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');

export default withPageConfig({
  resolve: {
    alias: {
      '@src': srcDir,
      '@extension/storage/lib': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'lib'),
      '@extension/storage': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'index.js'),
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'agent-manager'),
  },
});
