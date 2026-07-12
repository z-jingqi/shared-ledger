function currency(value, code) {
  const symbol = code === "USD" ? "$" : code === "EUR" ? "€" : "¥";
  return `${symbol}${Number(value || 0).toFixed(2)}`;
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

module.exports = { currency, shortDate, ymd };
