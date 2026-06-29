import type { OcrAdapter } from "../src/index";

/** Test double only; production code uses the Aleph Tools service adapter. */
export class MockOcrAdapter implements OcrAdapter {
  async recognize() {
    return { text: "超市购物 ¥38.50", confidence: 0.94 };
  }
}
