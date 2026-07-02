import { useAppSheetActions } from "../../features/sheets/SheetContext";
import { yuan } from "../../features/formatting/money";

export type LedgerTransaction = {
  id: string;
  type: "income" | "expense";
  amount: number;
  note?: string;
  occurredAt: string;
  categoryId?: string;
  categoryName?: string;
  memberId?: string;
  items?: Array<{ id?: string; name: string; amount: number; categoryId?: string; note?: string }>;
};
export function IosTransactionRow({
  transaction,
  categoryNames,
  currency,
}: {
  transaction: LedgerTransaction;
  categoryNames?: Record<string, string>;
  currency?: string;
}) {
  const { openSheet } = useAppSheetActions();
  const label = getCategoryLabel(transaction, categoryNames);
  const typeLabel = transaction.type === "income" ? "收入" : "支出";
  return (
    <button
      className="ios-transaction-row"
      data-transaction-id={transaction.id}
      type="button"
      onClick={() => openSheet({ type: "record-detail", transactionId: transaction.id })}
    >
      <span className="ios-transaction-category-name">{label}</span>
      <span className="ios-transaction-copy">
        <b>{transaction.note?.trim() || "无备注"}</b>
        <small className={transaction.type}>{typeLabel}</small>
      </span>
      <strong className={transaction.type}>
        {transaction.type === "income" ? "+" : "-"}
        {yuan(transaction.amount, currency)}
      </strong>
    </button>
  );
}

function getCategoryLabel(transaction: LedgerTransaction, categoryNames?: Record<string, string>) {
  if (transaction.categoryName) return transaction.categoryName;
  if (transaction.categoryId && categoryNames?.[transaction.categoryId])
    return categoryNames[transaction.categoryId];
  return transaction.categoryId ?? "未分类";
}
