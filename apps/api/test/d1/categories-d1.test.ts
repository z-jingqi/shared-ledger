import { describe, expect, it } from "vitest";
import { authHeaders, createD1TestApp, seedBook, seedMember, seedUser } from "./harness";

const jsonHeaders = { "Content-Type": "application/json" };

describe("D1 user categories", () => {
  it("keeps categories user-scoped across books and rejects other users' category ids", async () => {
    const context = createD1TestApp();
    const owner = seedUser(context.db, { id: "user_owner", name: "Owner", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const book = seedBook(context.db, owner, { id: "book_shared" });
    seedMember(context.db, book.id, member, "member");

    const ownerCategory = await context.app.request(
      "/me/categories",
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(owner) },
        body: JSON.stringify({ name: "餐饮", type: "expense", icon: "utensils", sortOrder: 0 }),
      },
      context.env,
    );
    const memberCategory = await context.app.request(
      "/me/categories",
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({ name: "餐饮", type: "expense", icon: "utensils", sortOrder: 0 }),
      },
      context.env,
    );
    const ownerCategoryBody = await ownerCategory.json<any>();
    const memberCategoryBody = await memberCategory.json<any>();
    expect(ownerCategory.status).toBe(201);
    expect(memberCategory.status).toBe(201);
    expect(ownerCategoryBody.category.id).not.toBe(memberCategoryBody.category.id);

    const secondBook = seedBook(context.db, owner, { id: "book_second" });
    const categoriesAfterSecondBook = await context.app.request("/me/categories", { headers: authHeaders(owner) }, context.env);
    const categoriesBody = await categoriesAfterSecondBook.json<any>();
    expect(categoriesBody.categories.filter((category: any) => category.name === "餐饮")).toHaveLength(1);
    expect(secondBook.createdByUserId).toBe(owner.id);

    const forbiddenUpdate = await context.app.request(
      `/categories/${ownerCategoryBody.category.id}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({ name: "别人的分类", type: "expense", icon: "tag", sortOrder: 0 }),
      },
      context.env,
    );
    expect(forbiddenUpdate.status).toBe(403);

    const forbiddenTransaction = await context.app.request(
      `/books/${book.id}/transactions`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({
          type: "expense",
          amount: 20,
          categoryId: ownerCategoryBody.category.id,
          note: "成员不能使用创建者个人分类",
          occurredAt: "2026-06-28T12:00:00.000Z",
          items: [],
        }),
      },
      context.env,
    );
    expect(forbiddenTransaction.status).toBe(400);
  });
});
