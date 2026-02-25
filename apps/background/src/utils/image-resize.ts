/**
 * Resize a base64-encoded image using OffscreenCanvas (service-worker compatible).
 * Returns a base64 JPEG string at the target dimensions.
 */
export async function resizeBase64Image(b64: string, targetWidth: number, targetHeight: number): Promise<string> {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);

    if (bitmap.width === targetWidth && bitmap.height === targetHeight) {
      bitmap.close();
      return b64;
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const buffer = await resizedBlob.arrayBuffer();
    const resizedBytes = new Uint8Array(buffer);

    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < resizedBytes.length; i += CHUNK) {
      binary += String.fromCharCode(...resizedBytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  } catch {
    return b64;
  }
}

/** Returns the recommended LLM screenshot dimensions for a model, or undefined for default. */
export function getScreenshotSizeForModel(modelName: string): [number, number] | undefined {
  const name = (modelName || '').toLowerCase();
  if (name.includes('claude-sonnet') || name.includes('claude-opus')) return [1400, 850];
  if (name.includes('gemini')) return [1200, 800];
  return undefined;
}
