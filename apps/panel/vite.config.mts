import { resolve } from 'node:path';
import { cpSync } from 'node:fs';
import { withPageConfig } from '@extension/vite-config';
import type { Plugin } from 'vite';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');
const sharedIconsDir = resolve(rootDir, '..', '..', 'packages', 'shared', 'assets', 'icons');

/** Copies shared icons into the build output so relative icon paths resolve correctly. */
function sharedIconsPlugin(): Plugin {
  return {
    name: 'copy-shared-icons',
    writeBundle(options) {
      const outDir = options.dir || resolve(rootDir, '..', '..', 'dist', 'panel');
      cpSync(sharedIconsDir, resolve(outDir, 'icons'), { recursive: true });
    },
    configureServer(server) {
      server.middlewares.use('/icons', (req, res, next) => {
        const fsPath = resolve(sharedIconsDir, (req.url || '').replace(/^\//, ''));
        res.setHeader('Content-Type', 'image/svg+xml');
        import('node:fs').then(fs => {
          try {
            const data = fs.readFileSync(fsPath);
            res.end(data);
          } catch {
            next();
          }
        });
      });
    },
  };
}

export default withPageConfig({
  plugins: [sharedIconsPlugin()],
  resolve: {
    alias: {
      '@src': srcDir,
      // Force storage to use built dist to avoid source/dist shape mismatches in runtime
      // Put '/lib' before root alias so nested imports resolve correctly
      '@extension/storage/lib': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'lib'),
      '@extension/storage': resolve(rootDir, '..', '..', 'packages', 'storage', 'dist', 'index.js'),
      '@extension/shared/lib': resolve(rootDir, '..', '..', 'packages', 'shared', 'dist', 'lib'),
      '@extension/shared': resolve(rootDir, '..', '..', 'packages', 'shared', 'dist', 'index.js'),
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'panel'),
    chunkSizeWarningLimit: 600,
  },
});
