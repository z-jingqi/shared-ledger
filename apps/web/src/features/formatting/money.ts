export function yuan(value: number | undefined | null, currency = "CNY") {
  return Number(value ?? 0).toLocaleString("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}
