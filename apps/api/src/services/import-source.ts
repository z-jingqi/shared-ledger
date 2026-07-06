import type { D1LedgerRepository } from "../repository";

const sourceAccessTokenBytes = 32;
export const importSourceAccessTtlMs = 72 * 60 * 60 * 1000;

export type ImportSourceAccess = {
  token: string;
  tokenHash: string;
  expiresAt: string;
};

export async function createImportSourceAccess(
  repository: D1LedgerRepository,
  importJobId: string,
): Promise<ImportSourceAccess> {
  const token = randomSourceAccessToken();
  const tokenHash = await hashImportSourceAccessToken(token);
  const expiresAt = new Date(Date.now() + importSourceAccessTtlMs).toISOString();
  await repository.storeImportSourceAccess(importJobId, tokenHash, expiresAt);
  return { token, tokenHash, expiresAt };
}

export async function hashImportSourceAccessToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64UrlEncode(new Uint8Array(digest));
}

export function bearerToken(value: string | undefined) {
  const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? "");
  return match?.[1]?.trim() || undefined;
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function randomSourceAccessToken() {
  const bytes = new Uint8Array(sourceAccessTokenBytes);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
