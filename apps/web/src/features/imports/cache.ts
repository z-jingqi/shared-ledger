import { apiQueryKey, ledgerQueryClient } from "../data/queryClient";
import type { ImportJobStatus } from "./status";

type ImportJobsCacheData = {
  imports: ImportJobStatus[];
  retentionDays?: number;
};

export function importJobsPath(bookId: string | undefined) {
  return bookId ? `/books/${bookId}/imports` : undefined;
}

export function upsertImportJobsInCache(
  bookId: string | undefined,
  userId: string | undefined,
  jobs: ImportJobStatus[],
) {
  if (!bookId || !jobs.length) return;
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
