import type { ZodType } from "zod";

export const jsonError = (context: any, message: string, status = 400) =>
  context.json({ error: message }, status);

export async function parseJson(context: any, schema: ZodType) {
  const result = schema.safeParse(await context.req.json());
  return result.success ? result.data : null;
}
