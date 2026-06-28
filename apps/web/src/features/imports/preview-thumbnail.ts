export type PreviewThumbnailOptions = {
  maxWidth?: number;
  maxHeight?: number;
  type?: "image/webp" | "image/jpeg";
  quality?: number;
  signal?: AbortSignal;
};

export async function createPreviewThumbnail(blob: Blob, options: PreviewThumbnailOptions = {}) {
  const {
    maxWidth = 240,
    maxHeight = 240,
    type = "image/webp",
    quality = 0.82,
    signal,
  } = options;
  if (!blob.type.startsWith("image/")) throw new Error("只能为图片生成预览缩略图");
  assertNotAborted(signal);

  let source: ImageBitmap | HTMLImageElement | undefined;
  try {
    source = await loadImageSource(blob, signal);
    assertNotAborted(signal);
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    const ratio = Math.min(1, maxWidth / width, maxHeight / height);
    const targetWidth = Math.max(1, Math.round(width * ratio));
    const targetHeight = Math.max(1, Math.round(height * ratio));
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(targetWidth, targetHeight)
        : Object.assign(document.createElement("canvas"), { width: targetWidth, height: targetHeight });
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) throw new Error("当前浏览器无法生成预览缩略图");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    assertNotAborted(signal);
    return await canvasToBlob(canvas, type, quality);
  } finally {
    if (source && "close" in source) source.close();
  }
}

async function loadImageSource(blob: Blob, signal?: AbortSignal) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  return loadImageElement(blob, signal);
}

function loadImageElement(blob: Blob, signal?: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    assertNotAborted(signal);
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("图片预览加载失败"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number) {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片预览生成失败"));
      },
      type,
      quality,
    );
  });
}

function assertNotAborted(signal?: AbortSignal): asserts signal is AbortSignal | undefined {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
