import type { Attachment } from '@extension/storage/lib/chat/types';
import { MAX_PERSISTENT_FILE_SIZE, ACCEPTED_MIME_TYPES, MAX_ATTACHMENT_COUNT } from '@extension/storage/lib/chat/types';

export interface PendingAttachment {
  id: string;
  file: File;
  filename: string;
  mimeType: string;
  size: number;
  status: 'loading' | 'ready' | 'error';
  dataUrl?: string;
  thumbnailDataUrl?: string;
  type: 'image' | 'document';
  ephemeral: boolean;
  error?: string;
}

const MAX_IMAGE_DIMENSION = 2048;
const THUMBNAIL_SIZE = 160;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB hard ceiling

function classifyFile(mime: string): 'image' | 'document' {
  return mime.startsWith('image/') ? 'image' : 'document';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const TRANSPARENCY_FORMATS = new Set(['image/png', 'image/webp', 'image/svg+xml', 'image/gif']);

function resizeImage(dataUrl: string, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width === 0 || img.height === 0) {
        resolve(dataUrl);
        return;
      }
      if (img.width <= maxDim && img.height <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const scale = maxDim / Math.max(img.width, img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const mime = dataUrl.match(/^data:(image\/[^;]+)/)?.[1] || 'image/jpeg';
      const outFormat = TRANSPARENCY_FORMATS.has(mime) ? 'image/png' : 'image/jpeg';
      resolve(canvas.toDataURL(outFormat, outFormat === 'image/jpeg' ? 0.85 : undefined));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

function generateThumbnail(dataUrl: string): Promise<string> {
  return resizeImage(dataUrl, THUMBNAIL_SIZE);
}

export function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return `Unsupported file type: ${file.type || 'unknown'}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (max ${MAX_FILE_SIZE / (1024 * 1024)} MB)`;
  }
  return null;
}

export async function processFile(file: File): Promise<PendingAttachment> {
  const id = crypto.randomUUID();
  const type = classifyFile(file.type);
  const ephemeral = file.size > MAX_PERSISTENT_FILE_SIZE;
  const base: PendingAttachment = {
    id,
    file,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    status: 'loading',
    type,
    ephemeral,
  };

  try {
    const error = validateFile(file);
    if (error) return { ...base, status: 'error', error };

    let dataUrl = await readFileAsDataUrl(file);

    let thumbnailDataUrl: string | undefined;
    if (type === 'image') {
      // Resize large images for the data sent to LLM
      dataUrl = await resizeImage(dataUrl, MAX_IMAGE_DIMENSION);
      thumbnailDataUrl = await generateThumbnail(dataUrl);
    }

    return { ...base, status: 'ready', dataUrl, thumbnailDataUrl };
  } catch (e) {
    return { ...base, status: 'error', error: e instanceof Error ? e.message : 'Processing failed' };
  }
}

export async function processFiles(files: File[], existingCount = 0): Promise<PendingAttachment[]> {
  const remaining = MAX_ATTACHMENT_COUNT - existingCount;
  const batch = files.slice(0, Math.max(0, remaining));
  return Promise.all(batch.map(processFile));
}

/** Convert a ready PendingAttachment to a persistable Attachment */
export function toAttachment(pa: PendingAttachment): Attachment {
  return {
    id: pa.id,
    filename: pa.filename,
    mimeType: pa.mimeType,
    size: pa.size,
    type: pa.type,
    dataUrl: pa.dataUrl,
    thumbnailDataUrl: pa.thumbnailDataUrl,
    ephemeral: pa.ephemeral,
  };
}

/**
 * Strip dataUrl from ephemeral attachments before persisting to chrome.storage.
 * Small attachments keep their data; large ones become tombstones.
 */
export function toStorableAttachment(a: Attachment): Attachment {
  if (a.ephemeral) {
    return { ...a, dataUrl: undefined, thumbnailDataUrl: undefined };
  }
  return a;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { MAX_ATTACHMENT_COUNT, ACCEPTED_MIME_TYPES, MAX_PERSISTENT_FILE_SIZE };
