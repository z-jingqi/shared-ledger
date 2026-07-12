import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const format = require("../miniprogram/utils/format.js");
const transactions = require("../miniprogram/utils/transactions.js");

test("formats ledger values for the native UI", () => {
  assert.equal(format.currency(12.5, "CNY"), "¥12.50");
  assert.equal(format.currency(12.5, "USD"), "$12.50");
});

test("groups transactions by date and preserves semantic amount colors", () => {
  const groups = transactions.groupTransactions(
    [
      { id: "a", type: "expense", amount: 12, occurredAt: "2026-07-12", note: "午饭" },
      { id: "b", type: "income", amount: 20, occurredAt: "2026-07-12", note: "退款" },
    ],
    "CNY",
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].transactions[0].amountClass, "expense");
  assert.equal(groups[0].transactions[1].amountClass, "income");
});

test("analysis page starts from the current week", () => {
  const source = readFileSync(new URL("../miniprogram/pages/analysis/index.js", import.meta.url), "utf8");
  assert.match(source, /range:\s*"week"/);
});

test("native app does not depend on a cross-platform framework", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies, undefined);
});
