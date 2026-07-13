export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function errorStatus(error: unknown) {
  return error instanceof Error ? (error as ApiError).statusCode : undefined;
}
