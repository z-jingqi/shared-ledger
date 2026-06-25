import { BriefcaseIcon, ForkKnifeIcon, ShoppingCartIcon } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { money } from "../../lib";

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
export function TransactionList({
  transactions,
  compact = false,
  categoryNames,
}: {
  transactions: LedgerTransaction[];
  compact?: boolean;
  categoryNames?: Record<string, string>;
}) {
  const shown = compact ? transactions.slice(0, 3) : transactions;
  if (!shown.length) return <p className="muted">还没有记录，记下第一笔吧。</p>;
  return (
    <div className="transaction-list">
      {shown.map((transaction) => {
        const Icon =
          transaction.type === "income"
            ? BriefcaseIcon
            : transaction.note?.includes("餐")
              ? ForkKnifeIcon
              : ShoppingCartIcon;
        return (
          <Link to={`/records/${transaction.id}`} className="transaction" key={transaction.id}>
            <span className="date">
              {new Date(transaction.occurredAt).toLocaleDateString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
              })}
            </span>
            <span className="category-icon">
              <Icon size={19} weight="fill" />
            </span>
            <span className="transaction-copy">
              <strong>{transaction.note || "未命名记录"}</strong>
              <small>{getCategoryLabel(transaction, categoryNames)}</small>
            </span>
            <strong className={transaction.type}>
              {transaction.type === "income" ? "+" : "-"}
              {money(transaction.amount)}
            </strong>
          </Link>
        );
      })}
    </div>
  );
}

function getCategoryLabel(transaction: LedgerTransaction, categoryNames?: Record<string, string>) {
  if (transaction.categoryName) return transaction.categoryName;
  if (transaction.categoryId && categoryNames?.[transaction.categoryId]) return categoryNames[transaction.categoryId];
  return transaction.categoryId ?? "未分类";
}
