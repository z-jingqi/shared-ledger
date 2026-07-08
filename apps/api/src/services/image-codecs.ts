import jpeg from "jpeg-js";
import createLibHeif from "libheif-js/libheif-wasm/libheif-bundle.mjs";
import libheifWasmModule from "libheif-js/libheif-wasm/libheif.wasm";

export async function convertUnsupportedImageToJpeg(
  bytes: ArrayBuffer,
  options: { maxPixels?: number; quality?: number } = {},
): Promise<ArrayBuffer> {
  const libheif = createLibHeif({
    instantiateWasm(imports, success) {
      const instance = new WebAssembly.Instance(libheifWasmModule, imports);
      success(instance, libheifWasmModule);
      return instance.exports;
    },
  });
  await libheif.ready;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(bytes));
  if (!images.length) throw new Error("图片中没有可解码图像");
  const image = images[0];
  try {
    const width = image.get_width();
    const height = image.get_height();
    const pixels = width * height;
    if (options.maxPixels && pixels > options.maxPixels) {
      throw new Error("图片像素过大，请压缩后重试");
    }
    const display = await new Promise<{ data: Uint8ClampedArray; width: number; height: number }>(
      (resolve, reject) => {
        image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (displayData) => {
          if (!displayData) reject(new Error("图片解码失败"));
          else resolve(displayData);
        });
      },
    );
    const encoded = jpeg.encode(
      {
        data: display.data,
        width: display.width,
        height: display.height,
      },
      options.quality ?? 88,
    );
    return toArrayBuffer(encoded.data);
  } finally {
    for (const item of images) item.free();
    decoder.decoder.delete();
  }
}

function toArrayBuffer(bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return copy.buffer;
}
