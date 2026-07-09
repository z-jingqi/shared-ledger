/// <reference types="vite/client" />

declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  type HeifImage = {
    get_width(): number;
    get_height(): number;
    display(
      imageData: { data: Uint8ClampedArray; width: number; height: number },
      callback: (displayData: { data: Uint8ClampedArray; width: number; height: number } | null) => void,
    ): void;
    free(): void;
  };

  type LibHeif = {
    ready: Promise<void>;
    HeifDecoder: new () => {
      decode(bytes: Uint8Array): HeifImage[];
      decoder: { delete(): void };
    };
  };

  export default function createLibHeif(options?: unknown): LibHeif;
}
