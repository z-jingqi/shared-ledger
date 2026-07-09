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
