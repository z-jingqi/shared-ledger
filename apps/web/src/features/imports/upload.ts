import { supportedFileAccept } from "@shared-ledger/shared";
import { api } from "../../lib";

export const maximumAttachmentFiles = 5;
export const supportedImportAccept = supportedFileAccept;

export type ImportBatchJob = {
  id: string;
  fileName: string;
  status: string;
};

export async function uploadImportFiles(bookId: string, files: File[], options?: { autoConfirm?: boolean }) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  if (options?.autoConfirm) body.append("autoConfirm", "true");
  return api<{ jobs: ImportBatchJob[] }>(`/books/${bookId}/imports/batch`, {
    method: "POST",
    body,
  });
}
