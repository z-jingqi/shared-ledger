import createLibHeif from "libheif-js/libheif-wasm/libheif-bundle.mjs";

export async function convertHeifToJpegBlob(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number; signal?: AbortSignal },
) {
  assertNotAborted(options.signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertNotAborted(options.signal);
  const libheif = createLibHeif();
  await libheif.ready;
  assertNotAborted(options.signal);
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);
  if (!images.length) throw new Error("图片中没有可解码图像");
  const image = images[0];
  try {
    const width = image.get_width();
    const height = image.get_height();
    const display = await new Promise<{ data: Uint8ClampedArray; width: number; height: number }>(
      (resolve, reject) => {
        image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (displayData) => {
          if (displayData) resolve(displayData);
          else reject(new Error("图片解码失败"));
        });
      },
    );
    assertNotAborted(options.signal);
    const ratio = Math.min(1, options.maxWidth / display.width, options.maxHeight / display.height);
    const targetWidth = Math.max(1, Math.round(display.width * ratio));
    const targetHeight = Math.max(1, Math.round(display.height * ratio));
    const canvas = Object.assign(document.createElement("canvas"), {
      width: targetWidth,
      height: targetHeight,
    });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("当前浏览器无法转换图片");
    const sourceCanvas = Object.assign(document.createElement("canvas"), {
      width: display.width,
      height: display.height,
    });
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("当前浏览器无法转换图片");
    const rgba = new Uint8ClampedArray(display.data.length);
    rgba.set(display.data);
    sourceContext.putImageData(new ImageData(rgba, display.width, display.height), 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
    assertNotAborted(options.signal);
    return await canvasToBlob(canvas, "image/jpeg", options.quality);
  } finally {
    for (const item of images) item.free();
    decoder.decoder.delete();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片转换失败"));
      },
      type,
      quality,
    );
  });
}

function assertNotAborted(signal?: AbortSignal): asserts signal is AbortSignal | undefined {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
