declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  type HeifImage = {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (displayData?: { data: Uint8ClampedArray; width: number; height: number }) => void,
    ): void;
    free(): void;
  };

  type HeifDecoder = {
    decode(buffer: Uint8Array): HeifImage[];
    decoder: { delete(): void };
  };

  type LibHeif = {
    ready?: Promise<void>;
    HeifDecoder: new () => HeifDecoder;
  };

  type CreateLibHeifOptions = {
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      success: (instance: WebAssembly.Instance, module?: WebAssembly.Module) => void,
    ) => WebAssembly.Exports;
  };

  export default function createLibHeif(options?: CreateLibHeifOptions): LibHeif;
}

declare module "libheif-js/libheif-wasm/libheif.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
