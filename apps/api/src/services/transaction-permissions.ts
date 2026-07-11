import { canMutateTransaction } from "@shared-ledger/shared";
import { D1LedgerRepository } from "../repository";
import type { MemoryLedgerStore } from "../store";

export async function canUserMutateTransaction(input: {
  repository?: D1LedgerRepository;
  store?: MemoryLedgerStore;
  bookId: string;
  actorId: string;
  createdByUserId: string;
}) {
  const actorMember = input.repository
    ? await input.repository.findMember(input.bookId, input.actorId)
    : input.store?.findMember(input.bookId, input.actorId);
  if (!actorMember) return false;

  if (input.actorId === input.createdByUserId) return true;

  const creatorMember = input.repository
    ? await input.repository.findMember(input.bookId, input.createdByUserId)
    : input.store?.findMember(input.bookId, input.createdByUserId);
  return canMutateTransaction(
    input.actorId,
    input.createdByUserId,
    actorMember.role,
    creatorMember?.allowAdminEdit ?? false,
  );
}
