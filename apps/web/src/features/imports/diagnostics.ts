import { api } from "../../lib";

export type AlephToolsDiagnosticsResponse = {
  success?: boolean;
  requestId?: string;
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

export function diagnoseImportOcrJob(importJobId: string) {
  return api<AlephToolsDiagnosticsResponse>(
    `/diagnostics/aleph-tools?importJobId=${encodeURIComponent(importJobId)}`,
  );
}
