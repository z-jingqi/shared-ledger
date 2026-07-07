export type ImportOcrRawDebugEntry = {
  importJobId: string;
  ocrJobId?: string;
  capturedAt?: string;
  source: "status-stream" | "diagnostics";
  result: unknown;
};

type OcrResultEventPayload = {
  importJobId?: string;
  ocrJobId?: string;
  capturedAt?: string;
  result?: unknown;
};

type DiagnosticsDebugPayload = {
  importJobId?: string;
  ocrJobId?: string;
  capturedAt?: string;
  ocrRawResult?: unknown;
  ocrRawError?: unknown;
};

const rawOcrDataByImportJob = new Map<string, ImportOcrRawDebugEntry>();

export function rememberOcrRawDataFromStatusStream(payload: OcrResultEventPayload) {
  if (!payload.importJobId || payload.result === undefined) return false;
  rawOcrDataByImportJob.set(payload.importJobId, {
    importJobId: payload.importJobId,
    ocrJobId: payload.ocrJobId,
    capturedAt: payload.capturedAt,
    source: "status-stream",
    result: payload.result,
  });
  return true;
}

export function rememberOcrRawDataFromDiagnostics(
  importJobId: string,
  payload: DiagnosticsDebugPayload | undefined,
) {
  if (!payload || payload.ocrRawResult === undefined) return false;
  rawOcrDataByImportJob.set(importJobId, {
    importJobId,
    ocrJobId: payload.ocrJobId,
    capturedAt: payload.capturedAt,
    source: "diagnostics",
    result: payload.ocrRawResult,
  });
  return true;
}

export function logOcrRawDataForImportJob(importJobId: string) {
  const entry = rawOcrDataByImportJob.get(importJobId);
  if (!entry) {
    console.info(`[shared-ledger OCR] import job ${importJobId} 暂无内存 OCR 原始数据`);
    return false;
  }
  const label = `[shared-ledger OCR] ${entry.importJobId} 原始识别结果`;
  if (typeof console.groupCollapsed === "function") {
    console.groupCollapsed(label);
    console.info("source", entry.source);
    if (entry.ocrJobId) console.info("ocrJobId", entry.ocrJobId);
    if (entry.capturedAt) console.info("capturedAt", entry.capturedAt);
    console.log(entry.result);
    console.groupEnd();
  } else {
    console.log(label, entry);
  }
  return true;
}
