/**
 * Browser-side preparation of images the learner attaches to the AI Tutor:
 * decode, downscale so the long edge is ≤ MAX_EDGE_PX and the file fits the
 * server cap, then upload to the chat media store.
 *
 * Screenshots stay PNG when they fit (EEG traces and text stay crisp);
 * photos and anything still too large fall back to JPEG.
 */

/** Must not exceed MAX_CHAT_IMAGE_BYTES on the server (lessonChat/media). */
export const MAX_UPLOAD_BYTES = 3_600_000;
/** Claude downsamples beyond ~1.5–2k px anyway; keep detail, cap the cost. */
export const MAX_EDGE_PX = 2048;

const PASSTHROUGH_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface UploadedChatImage {
  file: string;
  url: string;
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareChatImage(input: Blob): Promise<Blob> {
  let decoded;
  try {
    decoded = await decode(input);
  } catch {
    throw new Error('This image format cannot be read — use PNG, JPEG, GIF or WebP.');
  }
  try {
    const longEdge = Math.max(decoded.width, decoded.height);
    if (longEdge <= MAX_EDGE_PX && input.size <= MAX_UPLOAD_BYTES && PASSTHROUGH_TYPES.has(input.type)) {
      return input;
    }
    let scale = Math.min(1, MAX_EDGE_PX / longEdge);
    for (let attempt = 0; attempt < 4; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      if (input.type === 'image/png') {
        const png = await toBlob(canvas, 'image/png');
        if (png && png.size <= MAX_UPLOAD_BYTES) return png;
      }
      // JPEG has no alpha: paint transparent regions white, not black.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const jpeg = await toBlob(canvas, 'image/jpeg', 0.9);
      if (jpeg && jpeg.size <= MAX_UPLOAD_BYTES) return jpeg;
      scale *= 0.75;
    }
    throw new Error('Image is too large even after downscaling.');
  } finally {
    decoded.close();
  }
}

export async function uploadChatImage(blob: Blob): Promise<UploadedChatImage> {
  const res = await fetch('/api/lesson-chat/media', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const json = (await res.json().catch(() => ({}))) as { file?: string; url?: string; error?: string };
  if (!res.ok || !json.file || !json.url) {
    throw new Error(json.error ?? `Upload failed (status ${res.status})`);
  }
  return { file: json.file, url: json.url };
}

/** Image files from a paste — or none when the clipboard also carries text
 *  (copying from Word/Excel adds a picture of the selection; the learner
 *  wants the text then). */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const text = data.getData('text/plain');
  if (text && text.trim().length > 0) return [];
  return Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'));
}
