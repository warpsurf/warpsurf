import { resolve, extname } from 'node:path';
import { zipBundle } from './lib/zip-bundle';

const YYYYMMDD = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const HHmmss = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const fileName = `warpsurf-${YYYYMMDD}-${HHmmss}`;

function resolveArchiveName(): string {
  // Support overriding the archive file name via env var
  // Prefer ARCHIVE_NAME, then ZIP_NAME, then EXTENSION_ARCHIVE_NAME
  const desiredNameFromEnv =
    process.env.ARCHIVE_NAME || process.env.ZIP_NAME || process.env.EXTENSION_ARCHIVE_NAME;

  const isFirefox = Boolean(process.env.__FIREFOX__);

  if (desiredNameFromEnv && desiredNameFromEnv.trim().length > 0) {
    const hasExtension = extname(desiredNameFromEnv) !== '';
    if (hasExtension) {
      return desiredNameFromEnv;
    }
    return isFirefox ? `${desiredNameFromEnv}.xpi` : `${desiredNameFromEnv}.zip`;
  }

  return isFirefox ? `${fileName}.xpi` : `${fileName}.zip`;
}

// package the root dist file
zipBundle({
  distDirectory: resolve(__dirname, '../../dist'),
  buildDirectory: resolve(__dirname, '../../dist-zip'),
  archiveName: resolveArchiveName(),
});
