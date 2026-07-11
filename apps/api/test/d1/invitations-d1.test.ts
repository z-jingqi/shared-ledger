import { describe, expect, it } from "vitest";
import { authHeaders, createD1TestApp, seedBook, seedMember, seedTransaction, seedUser } from "./harness";

const jsonHeaders = { "Content-Type": "application/json" };
type Context = ReturnType<typeof createD1TestApp>;
type TestUser = ReturnType<typeof seedUser>;

async function sendInvitation(
  context: Context,
  bookId: string,
  inviter: TestUser,
  invitee: TestUser,
  role: "admin" | "member" = "member",
) {
  const response = await context.app.request(
    `/books/${bookId}/invitations`,
    {
      method: "POST",
      headers: { ...jsonHeaders, ...authHeaders(inviter) },
      body: JSON.stringify({ userId: invitee.id, role }),
    },
    context.env,
  );
  const body = await response.json<any>();
  return { response, body };
}

async function acceptInvitation(
  context: Context,
  invitationId: string,
  invitee: TestUser,
  allowAdminEdit?: boolean,
) {
  const hasBody = typeof allowAdminEdit === "boolean";
  const response = await context.app.request(
    `/invitations/${invitationId}/accept`,
    {
      method: "POST",
      headers: { ...(hasBody ? jsonHeaders : {}), ...authHeaders(invitee) },
      ...(hasBody ? { body: JSON.stringify({ allowAdminEdit }) } : {}),
    },
    context.env,
  );
  const body = await response.json<any>();
  return { response, body };
}

async function patchTransaction(
  context: Context,
  transactionId: string,
  actor: TestUser,
  body: Record<string, unknown>,
) {
  return context.app.request(
    `/transactions/${transactionId}`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, ...authHeaders(actor) },
      body: JSON.stringify(body),
    },
    context.env,
  );
}

describe("D1 invitation and member collaboration integrity", () => {
  it("enforces inviter roles, target validity, membership, and duplicate pending invitations", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const admin = seedUser(context.db, { id: "user_admin", name: "Admin", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const target = seedUser(context.db, { id: "user_target", name: "Target", plan: "pro" });
    const adminTarget = seedUser(context.db, {
      id: "user_admin_target",
      name: "AdminTarget",
      plan: "pro",
    });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    seedMember(context.db, book.id, admin, "admin");
    seedMember(context.db, book.id, member, "member");

    const memberInvite = await sendInvitation(context, book.id, member, target);
    expect(memberInvite.response.status).toBe(403);

    const memberHistory = await context.app.request(
      `/books/${book.id}/invitations`,
      { headers: authHeaders(member) },
      context.env,
    );
    expect(memberHistory.status).toBe(403);

    const selfInvite = await sendInvitation(context, book.id, creator, creator);
    expect(selfInvite.response.status).toBe(400);

    const existingMember = await sendInvitation(context, book.id, creator, member);
    expect(existingMember.response.status).toBe(409);

    const created = await sendInvitation(context, book.id, creator, target);
    expect(created.response.status).toBe(201);
    const duplicate = await sendInvitation(context, book.id, creator, target);
    expect(duplicate.response.status).toBe(409);

    const adminCreated = await sendInvitation(context, book.id, admin, adminTarget, "admin");
    expect(adminCreated.response.status).toBe(201);
    expect(adminCreated.body.invitation.role).toBe("admin");

    const adminHistory = await context.app.request(
      `/books/${book.id}/invitations`,
      { headers: authHeaders(admin) },
      context.env,
    );
    expect(adminHistory.status).toBe(200);
    expect((await adminHistory.json<any>()).invitations).toHaveLength(2);
  });

  it("defaults acceptance to private editing and applies consent changes immediately", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const admin = seedUser(context.db, { id: "user_admin", name: "Admin", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const peer = seedUser(context.db, { id: "user_peer", name: "Peer", plan: "pro" });
    const stranger = seedUser(context.db, { id: "user_stranger", name: "Stranger", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared", incomeEnabled: true });
    seedMember(context.db, book.id, admin, "admin");
    seedMember(context.db, book.id, peer, "member");

    const invited = await sendInvitation(context, book.id, creator, member);
    const wrongUser = await acceptInvitation(context, invited.body.invitation.id, stranger, true);
    expect(wrongUser.response.status).toBe(403);

    const invalidConsent = await context.app.request(
      `/invitations/${invited.body.invitation.id}/accept`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({ allowAdminEdit: "yes" }),
      },
      context.env,
    );
    expect(invalidConsent.status).toBe(400);
    expect(context.db.rows.invitations.find((row) => row.id === invited.body.invitation.id)?.status).toBe(
      "pending",
    );

    const accepted = await acceptInvitation(context, invited.body.invitation.id, member);
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.invitation).toMatchObject({
      status: "accepted",
      inviteeUserId: member.id,
      allowAdminEdit: false,
    });

    const membership = context.db.rows.book_members.find(
      (row) => row.book_id === book.id && row.user_id === member.id && !row.deleted_at,
    );
    const storedInvitation = context.db.rows.invitations.find((row) => row.id === invited.body.invitation.id);
    expect(membership).toMatchObject({ allow_admin_edit: 0, created_by_user_id: member.id });
    expect(storedInvitation).toMatchObject({
      allow_admin_edit: 0,
      updated_by_user_id: member.id,
    });

    const category = await context.repository.createCategory(
      member.id,
      {
        name: "成员餐饮",
        type: "expense",
        icon: "tag",
        color: "#FF681C",
        sortOrder: 1,
      },
      member.id,
    );
    const transaction = await context.repository.createTransaction(book.id, member.id, {
      type: "expense",
      amount: 30,
      categoryId: category.id,
      memberId: membership?.id,
      note: "成员午餐",
      occurredAt: "2026-07-11T12:00:00.000Z",
      items: [],
    });

    expect((await patchTransaction(context, transaction.id, creator, { note: "创建者修改" })).status).toBe(
      403,
    );
    expect((await patchTransaction(context, transaction.id, admin, { note: "管理员修改" })).status).toBe(403);
    expect((await patchTransaction(context, transaction.id, peer, { note: "同级成员修改" })).status).toBe(
      403,
    );
    expect((await patchTransaction(context, transaction.id, member, { note: "本人修改" })).status).toBe(200);

    const enable = await context.app.request(
      `/books/${book.id}/members/me/preferences`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({ allowAdminEdit: true }),
      },
      context.env,
    );
    expect(enable.status).toBe(200);
    expect((await enable.json<any>()).member.allowAdminEdit).toBe(true);

    const invalidPreference = await context.app.request(
      `/books/${book.id}/members/me/preferences`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({ allowAdminEdit: "yes" }),
      },
      context.env,
    );
    expect(invalidPreference.status).toBe(400);

    const creatorUpdate = await patchTransaction(context, transaction.id, creator, {
      note: "创建者协助修改",
    });
    const creatorBody = await creatorUpdate.json<any>();
    expect(creatorUpdate.status).toBe(200);
    expect(creatorBody.transaction).toMatchObject({
      note: "创建者协助修改",
      categoryId: category.id,
      categoryName: "成员餐饮",
    });
    expect((await patchTransaction(context, transaction.id, admin, { amount: 32 })).status).toBe(200);
    expect((await patchTransaction(context, transaction.id, peer, { amount: 33 })).status).toBe(403);

    const creatorDetail = await context.app.request(
      `/transactions/${transaction.id}`,
      { headers: authHeaders(creator) },
      context.env,
    );
    expect((await creatorDetail.json<any>()).permissions).toEqual({ canEdit: true, canDelete: true });

    const disable = await context.app.request(
      `/books/${book.id}/members/me/preferences`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, ...authHeaders(member) },
        body: JSON.stringify({ allowAdminEdit: false }),
      },
      context.env,
    );
    expect(disable.status).toBe(200);
    expect((await patchTransaction(context, transaction.id, creator, { amount: 34 })).status).toBe(403);
  });

  it("allows authorized managers to delete while never granting peer members access", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const admin = seedUser(context.db, { id: "user_admin", name: "Admin", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const peer = seedUser(context.db, { id: "user_peer", name: "Peer", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    seedMember(context.db, book.id, admin, "admin");
    const membership = seedMember(context.db, book.id, member, "member", true);
    seedMember(context.db, book.id, peer, "member", true);
    const transaction = await seedTransaction(context.repository, {
      bookId: book.id,
      userId: member.id,
      memberId: membership.id,
      note: "可协助删除",
    });

    const peerDelete = await context.app.request(
      `/transactions/${transaction.id}`,
      { method: "DELETE", headers: authHeaders(peer) },
      context.env,
    );
    expect(peerDelete.status).toBe(403);

    const adminDelete = await context.app.request(
      `/transactions/${transaction.id}`,
      { method: "DELETE", headers: authHeaders(admin) },
      context.env,
    );
    expect(adminDelete.status).toBe(204);
    expect(context.db.rows.transactions.find((row) => row.id === transaction.id)).toMatchObject({
      deleted_by_user_id: admin.id,
    });
  });

  it("preserves historical data, removes access after exit, and supports a clean re-invitation", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    const membership = seedMember(context.db, book.id, member, "member", true);
    const transaction = await seedTransaction(context.repository, {
      bookId: book.id,
      userId: member.id,
      memberId: membership.id,
      note: "退出前记录",
    });

    const exit = await context.app.request(
      `/books/${book.id}/members/me`,
      { method: "DELETE", headers: authHeaders(member) },
      context.env,
    );
    expect(exit.status).toBe(204);
    expect(
      (
        await context.app.request(
          `/transactions/${transaction.id}`,
          { headers: authHeaders(member) },
          context.env,
        )
      ).status,
    ).toBe(403);
    expect((await patchTransaction(context, transaction.id, member, { amount: 99 })).status).toBe(403);
    expect(
      (
        await context.app.request(
          `/transactions/${transaction.id}`,
          { method: "DELETE", headers: authHeaders(member) },
          context.env,
        )
      ).status,
    ).toBe(403);

    const creatorList = await context.app.request(
      `/books/${book.id}/transactions`,
      { headers: authHeaders(creator) },
      context.env,
    );
    expect((await creatorList.json<any>()).transactions).toEqual([
      expect.objectContaining({ id: transaction.id, note: "退出前记录", createdByUserId: member.id }),
    ]);

    const reinvited = await sendInvitation(context, book.id, creator, member);
    expect(reinvited.response.status).toBe(201);
    const reaccepted = await acceptInvitation(context, reinvited.body.invitation.id, member, false);
    expect(reaccepted.response.status).toBe(200);
    const memberRows = context.db.rows.book_members.filter(
      (row) => row.book_id === book.id && row.user_id === member.id,
    );
    expect(memberRows).toHaveLength(2);
    expect(memberRows.filter((row) => !row.deleted_at)).toHaveLength(1);
    expect(memberRows.find((row) => !row.deleted_at)?.allow_admin_edit).toBe(0);
  });

  it("keeps invitation history private per viewer and records the hiding actor", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const target = seedUser(context.db, { id: "user_target", name: "Target", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    const invited = await sendInvitation(context, book.id, creator, target);

    const declined = await context.app.request(
      `/invitations/${invited.body.invitation.id}/decline`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(target) },
        body: JSON.stringify({ blockInviter: false }),
      },
      context.env,
    );
    expect(declined.status).toBe(200);

    const hidden = await context.app.request(
      `/invitations/${invited.body.invitation.id}`,
      { method: "DELETE", headers: authHeaders(target) },
      context.env,
    );
    expect(hidden.status).toBe(204);

    const targetHistory = await context.app.request(
      "/invitations",
      { headers: authHeaders(target) },
      context.env,
    );
    const creatorHistory = await context.app.request(
      "/invitations",
      { headers: authHeaders(creator) },
      context.env,
    );
    expect((await targetHistory.json<any>()).invitations).toEqual([]);
    expect((await creatorHistory.json<any>()).invitations).toEqual([
      expect.objectContaining({ id: invited.body.invitation.id, status: "declined" }),
    ]);
    expect(context.db.rows.invitation_hidden_by[0]).toMatchObject({
      invitation_id: invited.body.invitation.id,
      user_id: target.id,
      created_by_user_id: target.id,
    });
  });

  it("expires stale invitations, permits re-inviting, and enforces reminder cooldown", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const target = seedUser(context.db, { id: "user_target", name: "Target", plan: "pro" });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    const invited = await sendInvitation(context, book.id, creator, target);
    const stored = context.db.rows.invitations.find((row) => row.id === invited.body.invitation.id)!;
    stored.expires_at = "2020-01-01T00:00:00.000Z";

    const received = await context.app.request(
      "/invitations/received",
      { headers: authHeaders(target) },
      context.env,
    );
    expect((await received.json<any>()).invitations[0]).toMatchObject({ status: "expired" });
    expect(stored.updated_by_user_id).toBe("0");

    const reinvited = await sendInvitation(context, book.id, creator, target);
    expect(reinvited.response.status).toBe(201);
    const remind = await context.app.request(
      `/invitations/${reinvited.body.invitation.id}/remind`,
      { method: "POST", headers: authHeaders(creator) },
      context.env,
    );
    expect(remind.status).toBe(200);
    const remindAgain = await context.app.request(
      `/invitations/${reinvited.body.invitation.id}/remind`,
      { method: "POST", headers: authHeaders(creator) },
      context.env,
    );
    expect(remindAgain.status).toBe(429);

    const revoke = await context.app.request(
      `/invitations/${reinvited.body.invitation.id}/revoke`,
      { method: "POST", headers: authHeaders(creator) },
      context.env,
    );
    expect(revoke.status).toBe(200);
    expect((await revoke.json<any>()).invitation.status).toBe("revoked");
  });

  it("blocks invitations and search until the invitee explicitly unblocks the inviter", async () => {
    const context = createD1TestApp();
    const creator = seedUser(context.db, { id: "user_creator", name: "Creator", plan: "pro" });
    const target = seedUser(context.db, {
      id: "user_target",
      name: "Target",
      email: "target@example.com",
      plan: "pro",
    });
    const book = seedBook(context.db, creator, { id: "book_shared" });
    const invited = await sendInvitation(context, book.id, creator, target);

    const declineAndBlock = await context.app.request(
      `/invitations/${invited.body.invitation.id}/decline`,
      {
        method: "POST",
        headers: { ...jsonHeaders, ...authHeaders(target) },
        body: JSON.stringify({ blockInviter: true }),
      },
      context.env,
    );
    expect(declineAndBlock.status).toBe(200);

    const blockedSearch = await context.app.request(
      "/users/search?query=target@example.com",
      { headers: authHeaders(creator) },
      context.env,
    );
    expect((await blockedSearch.json<any>()).users).toEqual([]);
    expect((await sendInvitation(context, book.id, creator, target)).response.status).toBe(403);

    const blocks = await context.app.request(
      "/users/invite-blocks",
      { headers: authHeaders(target) },
      context.env,
    );
    expect((await blocks.json<any>()).blocks).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ id: creator.id }) }),
    ]);

    const unblock = await context.app.request(
      `/users/${creator.id}/invite-blocks`,
      { method: "DELETE", headers: authHeaders(target) },
      context.env,
    );
    expect(unblock.status).toBe(204);
    const visibleSearch = await context.app.request(
      "/users/search?query=target@example.com",
      { headers: authHeaders(creator) },
      context.env,
    );
    expect((await visibleSearch.json<any>()).users).toEqual([
      expect.objectContaining({ id: target.id, name: target.name }),
    ]);
    expect((await sendInvitation(context, book.id, creator, target)).response.status).toBe(201);
  });
});
