import { api } from "../../lib";

export type AlephToolsDiagnosticsResponse = {
  success?: boolean;
  requestId?: string;
  sharedLedgerDebug?: {
    importJobId?: string;
    ocrJobId?: string;
    capturedAt?: string;
    ocrRawResult?: unknown;
    ocrRawError?: { code?: string; message?: string; requestId?: string; status?: string; stage?: string };
  };
  data?: {
    ok?: boolean;
    checks?: Record<string, { ok?: boolean; [key: string]: unknown }>;
    job?: {
      found?: boolean;
      storage?: {
        sourceAvailable?: boolean;
        resultObjectAvailable?: boolean;
      };
      snapshot?: {
        status?: string;
        progress?: number;
        stage?: string;
        error?: { code?: string; message?: string };
      };
    };
  };
};

export function diagnoseImportOcrJob(importJobId: string, options: { includeOcrRaw?: boolean } = {}) {
  const params = new URLSearchParams({ importJobId });
  if (options.includeOcrRaw) params.set("includeOcrRaw", "1");
  return api<AlephToolsDiagnosticsResponse>(`/diagnostics/aleph-tools?${params.toString()}`);
}
