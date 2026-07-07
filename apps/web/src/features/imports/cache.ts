import { apiQueryKey, ledgerQueryClient } from "../data/queryClient";
import type { ImportJobStatus } from "./status";

type ImportJobsCacheData = {
  imports: ImportJobStatus[];
  retentionDays?: number;
};

const localUploadPlaceholders = new Map<string, ImportJobStatus[]>();

export function importJobsPath(bookId: string | undefined) {
  return bookId ? `/books/${bookId}/imports` : undefined;
}

export function upsertImportJobsInCache(
  bookId: string | undefined,
  userId: string | undefined,
  jobs: ImportJobStatus[],
) {
  if (!bookId || !jobs.length) return;
  rememberLocalUploadPlaceholders(bookId, userId, jobs);
  ledgerQueryClient.setQueryData<ImportJobsCacheData>(
    apiQueryKey(importJobsPath(bookId), userId),
    (current) => {
      const byId = new Map((current?.imports ?? []).map((job) => [job.id, job]));
      for (const job of jobs) {
        const existing = byId.get(job.id);
        byId.set(job.id, mergeImportJob(existing, job));
      }
      return {
        ...current,
        imports: [...byId.values()].sort(compareImportJobs),
      };
    },
  );
}

export function replaceImportJobInCache(
  bookId: string | undefined,
  userId: string | undefined,
  job: ImportJobStatus,
) {
  upsertImportJobsInCache(bookId, userId, [job]);
}

export function patchImportJobInCache(
  bookId: string | undefined,
  userId: string | undefined,
  jobId: string,
  patch: Partial<ImportJobStatus>,
) {
  let previous: ImportJobStatus | undefined;
  if (!bookId) return previous;
  ledgerQueryClient.setQueryData<ImportJobsCacheData>(
    apiQueryKey(importJobsPath(bookId), userId),
    (current) => {
      if (!current?.imports?.length) return current;
      return {
        ...current,
        imports: current.imports.map((job) => {
          if (job.id !== jobId) return job;
          previous = job;
          return {
            ...job,
            ...patch,
            id: jobId,
            fileName: patch.fileName ?? job.fileName,
            status: patch.status ?? job.status,
            createdAt: patch.createdAt ?? job.createdAt,
            updatedAt: patch.updatedAt ?? job.updatedAt,
          };
        }),
      };
    },
  );
  return previous;
}

export function removeImportJobFromCache(
  bookId: string | undefined,
  userId: string | undefined,
  jobId: string,
) {
  let previous: ImportJobStatus | undefined;
  if (!bookId) return previous;
  forgetLocalUploadPlaceholders(bookId, userId, [jobId]);
  ledgerQueryClient.setQueryData<ImportJobsCacheData>(
    apiQueryKey(importJobsPath(bookId), userId),
    (current) => {
      if (!current?.imports?.length) return current;
      previous = current.imports.find((job) => job.id === jobId);
      return {
        ...current,
        imports: current.imports.filter((job) => job.id !== jobId),
      };
    },
  );
  return previous;
}

export function removeImportJobsFromCache(
  bookId: string | undefined,
  userId: string | undefined,
  jobIds: string[],
) {
  if (!bookId || !jobIds.length) return [];
  forgetLocalUploadPlaceholders(bookId, userId, jobIds);
  const idSet = new Set(jobIds);
  let removed: ImportJobStatus[] = [];
  ledgerQueryClient.setQueryData<ImportJobsCacheData>(
    apiQueryKey(importJobsPath(bookId), userId),
    (current) => {
      if (!current?.imports?.length) return current;
      removed = current.imports.filter((job) => idSet.has(job.id));
      return {
        ...current,
        imports: current.imports.filter((job) => !idSet.has(job.id)),
      };
    },
  );
  return removed;
}

export function mergeLocalImportPlaceholders(
  bookId: string | undefined,
  userId: string | undefined,
  imports: ImportJobStatus[],
) {
  const placeholders = localUploadPlaceholders.get(scopeKey(bookId, userId)) ?? [];
  if (!placeholders.length) return imports;
  const existingIds = new Set(imports.map((job) => job.id));
  return [...placeholders.filter((job) => !existingIds.has(job.id)), ...imports].sort(compareImportJobs);
}

function rememberLocalUploadPlaceholders(
  bookId: string | undefined,
  userId: string | undefined,
  jobs: ImportJobStatus[],
) {
  const placeholders = jobs.filter((job) => job.localOnly);
  if (!bookId || !placeholders.length) return;
  const key = scopeKey(bookId, userId);
  const byId = new Map((localUploadPlaceholders.get(key) ?? []).map((job) => [job.id, job]));
  placeholders.forEach((job) => byId.set(job.id, job));
  localUploadPlaceholders.set(key, [...byId.values()].sort(compareImportJobs));
}

function forgetLocalUploadPlaceholders(
  bookId: string | undefined,
  userId: string | undefined,
  jobIds: string[],
) {
  if (!bookId || !jobIds.length) return;
  const key = scopeKey(bookId, userId);
  const idSet = new Set(jobIds);
  const next = (localUploadPlaceholders.get(key) ?? []).filter((job) => !idSet.has(job.id));
  if (next.length) localUploadPlaceholders.set(key, next);
  else localUploadPlaceholders.delete(key);
}

function scopeKey(bookId: string | undefined, userId: string | undefined) {
  return `${userId ?? "anonymous"}:${bookId ?? "none"}`;
}

function mergeImportJob(existing: ImportJobStatus | undefined, incoming: ImportJobStatus) {
  return {
    ...existing,
    ...incoming,
    createdAt: incoming.createdAt ?? existing?.createdAt,
    updatedAt: incoming.updatedAt ?? existing?.updatedAt,
  };
}

function compareImportJobs(left: ImportJobStatus, right: ImportJobStatus) {
  return dateTime(right.createdAt) - dateTime(left.createdAt);
}

function dateTime(value: string | undefined) {
  const date = value ? new Date(value) : undefined;
  const timestamp = date?.getTime();
  return timestamp && Number.isFinite(timestamp) ? timestamp : 0;
}
