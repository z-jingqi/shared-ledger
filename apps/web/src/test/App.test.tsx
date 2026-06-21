import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
describe("shared ledger mobile UI", () => {
  beforeEach(() => { localStorage.clear(); window.history.pushState({}, "", "/"); });
  it("shows the book home and hides AI for a free user", () => { render(<App />); expect(screen.getByRole("heading", { name: "家庭账本" })).toBeInTheDocument(); expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument(); });
  it("shows AI controls after the demo user upgrades", async () => { const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole("link", { name: "我的" })); await user.click(screen.getByRole("button", { name: /切换为 Pro/ })); expect(screen.getByLabelText("打开 AI 助手")).toBeInTheDocument(); });
  it("navigates to the add record form", async () => { const user = userEvent.setup(); render(<App />); await user.click(screen.getAllByText("记一笔")[0]); expect(screen.getByRole("heading", { name: "记一笔" })).toBeInTheDocument(); });
});
