import { describe, expect, it } from "vitest";
import { authHeaders, createD1TestApp, seedBook, seedUser } from "./harness";

const jsonHeaders = { "Content-Type": "application/json" };

describe("D1 AI confirmation semantics", () => {
  it("does not apply destructive AI category changes until confirmation is accepted", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_ai", name: "AI User", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_ai" });

    const sessionResponse = await context.app.request(
      "/ai/sessions",
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(user) },
        body: JSON.stringify({ bookId: book.id, title: "新会话" }),
      },
      context.env,
    );
    const session = (await sessionResponse.json<any>()).session;
    expect(sessionResponse.status).toBe(201);

    const createCategory = await context.app.request(
      `/ai/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(user) },
        body: JSON.stringify({ bookId: book.id, message: "创建一个支出分类 医疗", page: "ai" }),
      },
      context.env,
    );
    expect(createCategory.status).toBe(200);
    expect(
      context.db.rows.categories.some(
        (row) => row.user_id === user.id && row.name === "医疗" && !row.deleted_at,
      ),
    ).toBe(true);

    const deleteCategory = await context.app.request(
      `/ai/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(user) },
        body: JSON.stringify({ bookId: book.id, message: "删除分类 医疗", page: "ai" }),
      },
      context.env,
    );
    const deleteBody = await deleteCategory.json<any>();
    const confirmation = deleteBody.parts.find(
      (part: any) => part.type === "confirmation-card",
    )?.confirmation;

    expect(deleteCategory.status).toBe(200);
    expect(confirmation?.id).toBeTruthy();
    expect(
      context.db.rows.categories.some(
        (row) => row.user_id === user.id && row.name === "医疗" && !row.deleted_at,
      ),
    ).toBe(true);

    const confirm = await context.app.request(
      `/ai/confirmations/${confirmation.id}/confirm`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );
    expect(confirm.status).toBe(200);
    const category = context.db.rows.categories.find((row) => row.user_id === user.id && row.name === "医疗");
    expect(category?.deleted_by_user_id).toBe(user.id);
    expect(category?.deleted_at).toBeTruthy();
    expect(context.db.rows.ai_confirmations.find((row) => row.id === confirmation.id)?.status).toBe(
      "confirmed",
    );
  });

  it("rejects confirmation execution for another user", async () => {
    const context = createD1TestApp();
    const owner = seedUser(context.db, { id: "user_owner", name: "Owner", plan: "pro" });
    const other = seedUser(context.db, { id: "user_other", name: "Other", plan: "pro" });
    const book = seedBook(context.db, owner, { id: "book_ai" });
    await context.repository.createAiConfirmation({
      userId: owner.id,
      bookId: book.id,
      action: "delete-category",
      payload: {
        skillName: "ledger.categories",
        toolName: "delete-category",
        args: { name: "医疗", type: "expense" },
      },
    });
    const confirmationId = context.db.rows.ai_confirmations[0].id;

    const response = await context.app.request(
      `/ai/confirmations/${confirmationId}/confirm`,
      { method: "POST", headers: authHeaders(other) },
      context.env,
    );

    expect(response.status).toBe(404);
    expect(context.db.rows.ai_confirmations[0].status).toBe("pending");
  });
});
