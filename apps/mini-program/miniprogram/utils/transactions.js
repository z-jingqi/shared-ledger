const { currency, ymd } = require("./format");

function transactionView(item, code) {
  return Object.assign({}, item, {
    amountText: currency(item.amount, code),
    categoryText: item.categoryName || "未分类",
    title: item.note || (item.type === "income" ? "收入" : "支出"),
    amountClass: item.type === "income" ? "income" : "expense",
  });
}

function groupTransactions(items, code) {
  const groups = new Map();
  items.forEach((item) => {
    const key = String(item.occurredAt || "").slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transactionView(item, code));
  });
  return [...groups.entries()].map(([date, transactions]) => ({
    date,
    label: dateLabel(date),
    total: currency(
      transactions.reduce((sum, item) => sum + (item.type === "expense" ? Number(item.amount) : 0), 0),
      code,
    ),
    transactions,
  }));
}

function dateLabel(value) {
  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getMonth() + 1}月${date.getDate()}日${weekdays[date.getDay()]}`;
}

function currentMonth(items) {
  const now = new Date();
  const prefix = ymd(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 7);
  return items.filter((item) => String(item.occurredAt || "").startsWith(prefix));
}

module.exports = { currentMonth, groupTransactions, transactionView };
