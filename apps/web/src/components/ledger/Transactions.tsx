import { Link } from "react-router-dom";
import { transactionIcons, transactions } from "../../features/ledger/data";
import { money } from "../../lib";

export function TransactionList({ compact = false }: { compact?: boolean }) {
  const shownTransactions = compact ? transactions.slice(0, 3) : transactions;

  return (
    <div className="transaction-list">
      {shownTransactions.map((transaction) => {
        const Icon = transactionIcons[transaction.icon];
        return (
          <Link to={`/records/${transaction.id}`} className="transaction" key={transaction.id}>
            <span className="date">{compact ? transaction.date : `2026年6月${transaction.date}日`}</span>
            <span className="category-icon">
              <Icon size={19} weight="fill" />
            </span>
            <span className="transaction-copy">
              <strong>{transaction.title}</strong>
              <small>
                {transaction.note} · {transaction.member}
              </small>
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
