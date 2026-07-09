import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortLocalImportUpload,
  createUploadPlaceholders,
  uploadImportFiles,
} from "../features/imports/upload";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("import upload cancellation", () => {
  it("carries the local placeholder preview onto the real backend job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jobs: [
                { id: "job_new", fileName: "receipt.png", fileType: "image/png", status: "ocr_processing" },
              ],
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    const [placeholder] = createUploadPlaceholders([file]);

    const result = await uploadImportFiles("book_test", [file], { placeholders: [placeholder] });

    expect(result.jobs[0].localPreviewUrl).toBe(placeholder.localPreviewUrl);
  });

  it("honors a local cancellation made before image preparation starts", async () => {
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    const [placeholder] = createUploadPlaceholders([file]);
    abortLocalImportUpload(placeholder.id);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadImportFiles("book_test", [file], { placeholders: [placeholder] }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
