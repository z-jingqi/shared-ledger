import { z } from "zod";

export const roles = ["creator", "admin", "member"] as const;
export type Role = (typeof roles)[number];
export const transactionTypes = ["income", "expense"] as const;
export type TransactionType = (typeof transactionTypes)[number];
export const subscriptionPlans = ["free", "pro"] as const;
export type SubscriptionPlan = (typeof subscriptionPlans)[number];
export const invitationStatuses = ["pending", "accepted", "declined", "expired", "revoked"] as const;
export const importStatuses = [
  "uploaded",
  "ocr_processing",
  "ai_processing",
  "pending_confirmation",
  "completed",
  "failed",
  "cancelled",
] as const;
export const importedRecordStatuses = ["pending", "confirmed", "ignored", "duplicated"] as const;
export const supportedFileTypes = [
  "image/jpg",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/tiff",
  "image/x-tiff",
  "image/bmp",
  "image/x-ms-bmp",
  "image/raw",
  "image/x-raw",
  "image/dng",
  "image/x-dng",
  "image/x-adobe-dng",
] as const;
export type SupportedFileType = (typeof supportedFileTypes)[number];
export const supportedFileExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp",
  ".raw",
  ".dng",
] as const;
export const supportedFileAccept = [...supportedFileTypes, ...supportedFileExtensions].join(",");
export const imageOcrDailyLimits = { free: 0, pro: 10 } as const satisfies Record<SubscriptionPlan, number>;

export const idSchema = z.string().min(1).max(64);
export const moneySchema = z.coerce.number().positive().finite().multipleOf(0.01);
export const createBookSchema = z.object({
  name: z.string().trim().min(1).max(60),
  currency: z.string().trim().length(3).default("CNY"),
  note: z.string().max(300).optional(),
});
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  password: z.string().min(6).max(128),
});
export const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1).max(128),
});
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().optional().or(z.literal("")),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(6).max(128),
});
export const subscriptionContactSchema = z
  .object({ email: z.string().email().optional(), phone: z.string().trim().min(6).max(30).optional() })
  .refine((value) => value.email || value.phone, "订阅前请补充邮箱或手机号");
export const createTransactionSchema = z
  .object({
    type: z.enum(transactionTypes),
    amount: moneySchema,
    categoryId: idSchema.optional(),
    memberId: idSchema.optional(),
    note: z.string().max(500).optional(),
    occurredAt: z.string().datetime().or(z.string().date()),
    items: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          amount: moneySchema,
          categoryId: idSchema.optional(),
          note: z.string().max(500).optional(),
        }),
      )
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.items.length) {
      const sum = value.items.reduce((total, item) => total + item.amount, 0);
      if (Math.abs(sum - value.amount) > 0.001)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "明细金额总和必须等于记录金额",
          path: ["items"],
        });
    }
  });
export const inviteSchema = z
  .object({
    target: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(6).max(30).optional(),
    userId: idSchema.optional(),
    role: z.enum(["admin", "member"]).default("member"),
  })
  .refine((data) => data.target || data.email || data.phone || data.userId, "请输入邮箱、手机号、用户名或用户 ID");
export const categorySchema = z.object({
  name: z.string().trim().min(1).max(30),
  type: z.enum(transactionTypes),
  icon: z.string().max(40).default("tag"),
  sortOrder: z.number().int().min(0).default(0),
});
export const aiImportRecordSchema = z.object({
  type: z.enum(transactionTypes),
  amount: moneySchema,
  occurredAt: z.string(),
  note: z.string().max(500).optional(),
  categoryName: z.string().max(30).optional(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).default([]),
});
export const aiActionNames = [
  "chat",
  "create-record",
  "update-record",
  "delete-record",
  "search-records",
  "analyze-records",
  "create-category",
  "update-category",
  "delete-category",
  "create-book",
  "update-book",
  "delete-book",
  "update-profile",
  "update-member",
  "remove-member",
  "invite-member",
  "export-book",
  "save-attachments",
  "confirm-import-batch",
  "cancel-task",
  "retry-task",
] as const;
export type AiActionName = (typeof aiActionNames)[number];
export const aiConfirmationActionSchema = z.enum(aiActionNames);
export type AiConfirmationAction = z.infer<typeof aiConfirmationActionSchema>;

const aiEntityNameSchema = z.string().trim().min(1).max(80);
const aiDateValueSchema = z.string().trim().min(1).max(40);
const aiAmountFilterSchema = z.coerce.number().nonnegative().finite().multipleOf(0.01);
const aiSortSchema = z.enum(["occurredAt_desc", "occurredAt_asc", "amount_desc", "amount_asc"]).default("occurredAt_desc");

export const aiTransactionCandidateSchema = z.object({
  type: z.enum(transactionTypes).optional(),
  amount: moneySchema.optional(),
  amountText: z.string().trim().max(80).optional(),
  occurredAt: aiDateValueSchema.optional(),
  dateExpression: z.string().trim().max(120).optional(),
  currency: z.string().trim().length(3).optional(),
  categoryId: idSchema.optional(),
  categoryName: aiEntityNameSchema.optional(),
  memberId: idSchema.optional(),
  memberName: aiEntityNameSchema.optional(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        amount: moneySchema,
        categoryId: idSchema.optional(),
        categoryName: aiEntityNameSchema.optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string().trim().min(1).max(300)).default([]),
});
export type AiTransactionCandidate = z.infer<typeof aiTransactionCandidateSchema>;

export const aiTransactionSearchSchema = z.object({
  bookId: idSchema.optional(),
  query: z.string().trim().max(500).optional(),
  pageContext: z.string().trim().max(120).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  type: z.enum(transactionTypes).optional(),
  from: aiDateValueSchema.optional(),
  to: aiDateValueSchema.optional(),
  minAmount: aiAmountFilterSchema.optional(),
  maxAmount: aiAmountFilterSchema.optional(),
  categoryIds: z.array(idSchema).default([]),
  categoryNames: z.array(aiEntityNameSchema).default([]),
  memberIds: z.array(idSchema).default([]),
  memberNames: z.array(aiEntityNameSchema).default([]),
  limit: z.number().int().min(1).max(100).default(20),
  sort: aiSortSchema,
});
export type AiTransactionSearch = z.infer<typeof aiTransactionSearchSchema>;
export type AiTransactionSearchInput = AiTransactionSearch;

export const aiNormalizedSearchFiltersSchema = z.object({
  bookId: idSchema.optional(),
  query: z.string().trim().max(500).optional(),
  type: z.enum(transactionTypes).optional(),
  from: aiDateValueSchema.optional(),
  to: aiDateValueSchema.optional(),
  minAmount: aiAmountFilterSchema.optional(),
  maxAmount: aiAmountFilterSchema.optional(),
  categoryIds: z.array(idSchema).default([]),
  memberIds: z.array(idSchema).default([]),
  limit: z.number().int().min(1).max(100).default(20),
  sort: aiSortSchema,
});
export type AiNormalizedSearchFilters = z.infer<typeof aiNormalizedSearchFiltersSchema>;

export const aiIngestionResultSchema = z.object({
  status: z.enum(["not_requested", "pending", "ready", "needs_confirmation", "completed", "failed"]).default("not_requested"),
  source: z.enum(["text", "attachment", "import-batch", "task"]).optional(),
  attachmentIds: z.array(idSchema).default([]),
  importJobIds: z.array(idSchema).default([]),
  candidates: z.array(aiTransactionCandidateSchema).default([]),
  transactionId: idSchema.optional(),
  missingFields: z.array(z.string().trim().min(1).max(80)).default([]),
  summary: z.string().trim().max(1000).optional(),
  message: z.string().trim().max(1000).optional(),
  warnings: z.array(z.string().trim().min(1).max(300)).default([]),
});
export type AiIngestionResult = z.infer<typeof aiIngestionResultSchema>;

export type CreateBookInput = z.infer<typeof createBookSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const aiConfirmationStatuses = ["pending", "confirmed", "cancelled"] as const;
export type AiConfirmationStatus = (typeof aiConfirmationStatuses)[number];
export const aiTaskStatuses = ["queued", "running", "pending_confirmation", "completed", "failed", "cancelled"] as const;
export type AiTaskStatus = (typeof aiTaskStatuses)[number];

export type AiToolStatusPart = {
  type: "tool-status";
  tool: AiActionName;
  status: "success" | "error" | "pending_confirmation";
  message: string;
  label?: string;
};
export type AiRecordCardPart = {
  type: "record-card";
  title?: string;
  transactionId: string;
  transactionType: TransactionType;
  amount: number;
  categoryId?: string;
  categoryName?: string;
  note?: string;
  occurredAt: string;
  pageName?: string;
  href?: string;
};
export type AiSearchResultCardPart = {
  type: "search-result-card";
  title: string;
  summary?: string;
  results: Array<{
    id: string;
    title: string;
    description?: string;
    amount?: number;
  }>;
  pageName?: string;
  href?: string;
};
export type AiFilterResultPart = {
  type: "filter-result";
  filters: Record<string, unknown>;
  chips?: string[];
  href?: string;
};
export type AiAnalysisCardPart = {
  type: "analysis-card";
  title: string;
  summary?: string;
  metrics: Array<{ label: string; value: string | number; hint?: string }>;
};
export type AiNavigationCardPart = {
  type: "navigation-card";
  pageName: string;
  href: string;
  description?: string;
};
export type AiConfirmationCardPart = {
  type: "confirmation-card";
  confirmation: {
    id: string;
    action: AiConfirmationAction;
    status: AiConfirmationStatus;
    expiresAt: string;
    summary: string;
    confirmLabel: string;
    cancelLabel: string;
  };
};
export type AiProfileCardPart = {
  type: "profile-card";
  title?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
};
export type AiMemberCardPart = {
  type: "member-card";
  title?: string;
  name?: string;
  role?: Role;
  status?: string;
};
export type AiChatPart =
  | { type: "text"; text: string }
  | AiToolStatusPart
  | AiRecordCardPart
  | AiFilterResultPart
  | AiSearchResultCardPart
  | AiAnalysisCardPart
  | AiProfileCardPart
  | AiMemberCardPart
  | AiNavigationCardPart
  | AiConfirmationCardPart;
export type AiChatResponse = {
  sessionId: string;
  message: { id: string; role: "assistant"; parts: AiChatPart[] };
  parts: AiChatPart[];
};

export type Actor = { id: string; plan: SubscriptionPlan };
export function canDeleteBook(role: Role) {
  return role === "creator";
}
export function canInvite(role: Role) {
  return role === "creator" || role === "admin";
}
export function canManageMembers(role: Role) {
  return role === "creator" || role === "admin";
}
export function canMutateTransaction(actorId: string, createdByUserId: string) {
  return actorId === createdByUserId;
}
export function canUseAi(plan: SubscriptionPlan) {
  return plan === "free" || plan === "pro";
}
