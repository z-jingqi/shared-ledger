import { describe, expect, it } from "vitest";
import { authHeaders, createD1TestApp, seedBook, seedMember, seedTransaction, seedUser } from "./harness";

const jsonHeaders = { "Content-Type": "application/json" };

describe("D1 members and transaction integrity", () => {
  it("keeps historical member transactions after the member exits and then denies future access", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    const membership = seedMember(context.db, book.id, member, "member");

    const created = await context.app.request(
      `/books/${book.id}/transactions`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({
          type: "expense",
          amount: 24,
          memberId: membership.id,
          note: "成员晚餐",
          occurredAt: "2026-06-28T18:00:00.000Z",
          items: [],
        }),
      },
      context.env,
    );
    const createdBody = await created.json<any>();

    expect(created.status).toBe(201);
    expect(createdBody.transaction).toMatchObject({
      bookId: book.id,
      createdByUserId: member.id,
      memberId: membership.id,
      note: "成员晚餐",
    });

    const exit = await context.app.request(
      `/books/${book.id}/members/me`,
      { method: "DELETE", headers: authHeaders(member) },
      context.env,
    );
    expect(exit.status).toBe(204);

    const memberListAfterExit = await context.app.request(
      `/books/${book.id}/transactions`,
      { headers: authHeaders(member) },
      context.env,
    );
    expect(memberListAfterExit.status).toBe(403);

    const creatorList = await context.app.request(
      `/books/${book.id}/transactions`,
      { headers: authHeaders(creator) },
      context.env,
    );
    const creatorListBody = await creatorList.json<any>();
    expect(creatorList.status).toBe(200);
    expect(creatorListBody.transactions).toHaveLength(1);
    expect(creatorListBody.transactions[0]).toMatchObject({
      createdByUserId: member.id,
      memberId: membership.id,
      note: "成员晚餐",
    });

    const deletedMembership = context.db.rows.book_members.find((row) => row.id === membership.id);
    expect(deletedMembership?.deleted_by_user_id).toBe(member.id);
    expect(deletedMembership?.deleted_at).toBeTruthy();
  });

  it("prevents removing or exiting as the creator while allowing managers to remove normal members", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const admin = seedUser(context.db, { id: "user_admin", name: "Admin", plan: "pro" });
    const normal = seedUser(context.db, { id: "user_normal", name: "Normal", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    seedMember(context.db, book.id, admin, "admin");
    const normalMembership = seedMember(context.db, book.id, normal, "member");

    const creatorExit = await context.app.request(
      `/books/${book.id}/members/me`,
      { method: "DELETE", headers: authHeaders(creator) },
      context.env,
    );
    expect(creatorExit.status).toBe(400);

    const creatorMembership = context.db.rows.book_members.find((row) => row.book_id === book.id && row.user_id === creator.id);
    const removeCreator = await context.app.request(
      `/books/${book.id}/members/${creatorMembership?.id}`,
      { method: "DELETE", headers: authHeaders(admin) },
      context.env,
    );
    expect(removeCreator.status).toBe(404);

    const removeNormal = await context.app.request(
      `/books/${book.id}/members/${normalMembership.id}`,
      { method: "DELETE", headers: authHeaders(admin) },
      context.env,
    );
    expect(removeNormal.status).toBe(204);
    expect(context.db.rows.book_members.find((row) => row.id === normalMembership.id)?.deleted_by_user_id).toBe(admin.id);
  });

  it("soft-deletes transactions with actor audit fields and hides them from normal lists", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    const transaction = await seedTransaction(context.repository, {
      bookId: book.id,
      userId: creator.id,
      amount: 66,
      note: "要删除的记录",
    });

    const deleted = await context.app.request(
      `/transactions/${transaction.id}`,
      { method: "DELETE", headers: authHeaders(creator) },
      context.env,
    );
    const list = await context.app.request(`/books/${book.id}/transactions`, { headers: authHeaders(creator) }, context.env);
    const listBody = await list.json<any>();

    expect(deleted.status).toBe(204);
    expect(listBody.transactions).toEqual([]);
    const stored = context.db.rows.transactions.find((row) => row.id === transaction.id);
    expect(stored?.deleted_by_user_id).toBe(creator.id);
    expect(stored?.deleted_at).toBeTruthy();
  });
});
