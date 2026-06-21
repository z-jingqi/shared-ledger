import { z } from "zod";

export const roles = ["creator", "admin", "member"] as const;
export type Role = (typeof roles)[number];
export const transactionTypes = ["income", "expense"] as const;
export type TransactionType = (typeof transactionTypes)[number];
export const subscriptionPlans = ["free", "pro"] as const;
export type SubscriptionPlan = (typeof subscriptionPlans)[number];
export const invitationStatuses = ["pending", "accepted", "declined", "expired", "revoked"] as const;
export const importStatuses = ["uploaded", "parsing", "ocr_processing", "ai_processing", "pending_confirmation", "completed", "failed"] as const;
export const importedRecordStatuses = ["pending", "confirmed", "ignored", "duplicated"] as const;

export const idSchema = z.string().min(1).max(64);
export const moneySchema = z.coerce.number().positive().finite().multipleOf(0.01);
export const createBookSchema = z.object({ name: z.string().trim().min(1).max(60), currency: z.string().trim().length(3).default("CNY"), note: z.string().max(300).optional() });
export const createTransactionSchema = z.object({
  type: z.enum(transactionTypes), amount: moneySchema, categoryId: idSchema.optional(), accountId: idSchema.optional(), memberId: idSchema.optional(), note: z.string().max(500).optional(), occurredAt: z.string().datetime().or(z.string().date()),
  tagIds: z.array(idSchema).default([]),
  items: z.array(z.object({ name: z.string().min(1).max(120), amount: moneySchema, categoryId: idSchema.optional(), note: z.string().max(500).optional() })).default([])
}).superRefine((value, ctx) => {
  if (value.items.length) {
    const sum = value.items.reduce((total, item) => total + item.amount, 0);
    if (Math.abs(sum - value.amount) > 0.001) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "明细金额总和必须等于记录金额", path: ["items"] });
  }
});
export const inviteSchema = z.object({ email: z.string().email().optional(), phone: z.string().min(6).max(30).optional(), role: z.enum(["admin", "member"]).default("member") }).refine((data) => data.email || data.phone, "请提供邮箱或手机号");
export const categorySchema = z.object({ name: z.string().trim().min(1).max(30), type: z.enum(transactionTypes), icon: z.string().max(40).default("tag"), sortOrder: z.number().int().min(0).default(0) });
export const tagSchema = z.object({ name: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff6b1a") });
export const accountSchema = z.object({ name: z.string().trim().min(1).max(30), type: z.string().trim().min(1).max(30) });
export const aiImportRecordSchema = z.object({ type: z.enum(transactionTypes), amount: moneySchema, occurredAt: z.string(), note: z.string().max(500).optional(), categoryName: z.string().max(30).optional(), confidence: z.number().min(0).max(1), warnings: z.array(z.string()).default([]) });
export type CreateBookInput = z.infer<typeof createBookSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export type Actor = { id: string; plan: SubscriptionPlan };
export function canDeleteBook(role: Role) { return role === "creator"; }
export function canInvite(role: Role) { return role === "creator" || role === "admin"; }
export function canManageMembers(role: Role) { return role === "creator" || role === "admin"; }
export function canMutateTransaction(actorId: string, createdByUserId: string) { return actorId === createdByUserId; }
export function canUseAi(plan: SubscriptionPlan) { return plan === "pro"; }

