import { Container } from "@cloudflare/containers";
import type { OcrAdapter, OcrResult } from "@shared-ledger/import";

export class PaddleOcrContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "2m";
  enableInternet = false;
}

type OcrContainerBinding = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): {
    startAndWaitForPorts(): Promise<void>;
    containerFetch(input: string, init: RequestInit): Promise<Response>;
  };
};

/** Bridges Worker queue jobs to the production OCR Container. */
export class PaddleOcrContainerAdapter implements OcrAdapter {
  constructor(private readonly binding?: OcrContainerBinding) {}

  async recognize(input: { bytes: ArrayBuffer; mimeType: string }): Promise<OcrResult> {
    if (!this.binding) throw new Error("OCR Container 未配置，无法识别图片或 PDF");
    const container = this.binding.get(this.binding.idFromName("shared-ledger-ocr"));
    await container.startAndWaitForPorts();
    const response = await container.containerFetch("http://container/recognize", {
      method: "POST",
      headers: { "content-type": input.mimeType },
      body: input.bytes,
    });
    if (!response.ok) throw new Error(`OCR Container 识别失败（${response.status}）`);
    const data = await response.json<{ text?: string; confidence?: number; pages?: number }>();
    if (!data.text) throw new Error("OCR Container 未返回可识别文本");
    return { text: data.text, confidence: data.confidence ?? 0, pages: data.pages };
  }
}
