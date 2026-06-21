import { describe, expect, it } from "vitest";
import {
  canDeleteBook,
  canInvite,
  canManageMembers,
  canMutateTransaction,
  canUseAi,
  createTransactionSchema,
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
  it("limits transaction mutation and AI access", () => {
    expect(canMutateTransaction("u1", "u1")).toBe(true);
    expect(canMutateTransaction("u2", "u1")).toBe(false);
    expect(canUseAi("free")).toBe(false);
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
});
