import { expect, test } from "@playwright/test";

test("authenticated user can navigate from a real book response to a record form", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/auth/me")
      ? { user: { id: "user_test", name: "测试用户", email: "test@example.com", plan: "free" } }
      : path.endsWith("/books")
        ? { books: [{ id: "book_test", name: "家庭账本", currency: "CNY" }] }
        : path.endsWith("/me/categories")
          ? { categories: [] }
          : path.includes("/books/book_test/transactions")
            ? { transactions: [] }
            : path.includes("/books/book_test/imports")
              ? { imports: [] }
              : path.includes("/books/book_test")
                ? { book: { id: "book_test", name: "家庭账本", currency: "CNY" } }
                : {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/");
  await page.getByText("家庭账本").click();
  await expect(page.getByRole("heading", { name: "家庭账本" })).toBeVisible();
  await expect(page.getByLabel("打开 AI 助手")).toHaveCount(0);
  await page.getByText("记一笔").click();
  await expect(page.getByRole("heading", { name: "新增记录" })).toBeVisible();
});
