import { expect, test } from "@playwright/test";
test("free user can add a transaction and does not see AI", async ({ page }) => { await page.goto("/"); await expect(page.getByRole("heading", { name: "家庭账本" })).toBeVisible(); await expect(page.getByLabel("打开 AI 助手")).toHaveCount(0); await page.getByText("记一笔").first().click(); await page.getByPlaceholder("0.00").fill("42.50"); await page.getByText("保存记录").click(); await expect(page.getByRole("heading", { name: "记录列表" })).toBeVisible(); });

