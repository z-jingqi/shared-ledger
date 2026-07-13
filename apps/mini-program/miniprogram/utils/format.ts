export function currency(value: number, code = "CNY") {
  const symbol = code === "USD" ? "$" : code === "EUR" ? "€" : "¥";
  return `${symbol}${Number(value || 0).toFixed(2)}`;
}

export function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
