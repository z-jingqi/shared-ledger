import { describe, expect, it } from "vitest";
import {
  canDeleteBook,
  canInvite,
  canManageMembers,
  canMutateTransaction,
  canUseAi,
  createTransactionSchema,
  registerSchema,
} from "../src/index";

describe("permissions and transaction constraints", () => {
  it("preserves book and member permission boundaries", () => {
    expect(canDeleteBook("creator")).toBe(true);
    expect(canDeleteBook("admin")).toBe(false);
    expect(canInvite("admin")).toBe(true);
    expect(canInvite("member")).toBe(false);
    expect(canManageMembers("creator")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
  });
  it("limits transaction mutation and allows AI for all plans", () => {
    expect(canMutateTransaction("u1", "u1")).toBe(true);
    expect(canMutateTransaction("u2", "u1")).toBe(false);
    expect(canUseAi("free")).toBe(true);
    expect(canUseAi("pro")).toBe(true);
  });
  it("rejects line-item totals that do not match", () => {
    expect(
      createTransactionSchema.safeParse({
        type: "expense",
        amount: 10,
        occurredAt: "2026-01-01",
        items: [{ name: "a", amount: 9 }],
      }).success,
    ).toBe(false);
  });
  it("requires at least six characters for registration passwords", () => {
    expect(registerSchema.safeParse({ name: "tester", password: "123456" }).success).toBe(true);
    expect(registerSchema.safeParse({ name: "tester", password: "12345" }).success).toBe(false);
  });
});
