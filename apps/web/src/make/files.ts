import type { MaterialFile } from "./states";

/** Base64 of bytes, in chunks: one photo is larger than one function call can take. */
export function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

/** A PDF, Markdown, or anything else as plain text, as the iPhone's file picker sends it. */
export function fileMediaType(name: string, type: string): MaterialFile["mediaType"] {
  const lower = name.toLowerCase();
  if (type === "application/pdf" || lower.endsWith(".pdf")) return "application/pdf";
  if (type === "text/markdown" || lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  return "text/plain";
}

/** Photos go to the server as JPEGs no longer than 1,568 pixels on a side: the model reads no more. */
export async function jpegBase64(file: File, maxSide = 1568): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => {
      resolve(next);
    }, "image/jpeg", 0.7);
  });
  if (!blob) return null;
  return bytesBase64(new Uint8Array(await blob.arrayBuffer()));
}

export async function fileBase64(file: File): Promise<string> {
  return bytesBase64(new Uint8Array(await file.arrayBuffer()));
}
