const api = require("../../services/api");
const session = require("../../services/session");
const { currency, ymd } = require("../../utils/format");

Page({
  data: {
    book: null,
    loading: true,
    range: "week",
    transactions: [],
    bars: [],
    selectedBar: null,
    showExpense: true,
    showIncome: true,
    expense: "¥0.00",
    income: "¥0.00",
    categories: [],
    members: [],
    bookMark: "账",
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      if (!getApp().globalData.activeBook) await session.restore();
      const book = getApp().globalData.activeBook;
      if (!book) {
        this.setData({ loading: false, book: null });
        return;
      }
      const [transactionResult, memberResult] = await Promise.all([
        api.request({ path: `/books/${book.id}/transactions` }),
        api.request({ path: `/books/${book.id}/members` }).catch(() => ({ members: [] })),
      ]);
      this.setData({
        book,
        bookMark: book.name ? book.name.slice(0, 1) : "账",
        transactions: transactionResult.transactions || [],
        memberSource: memberResult.members || [],
        loading: false,
      });
      this.rebuild();
    } catch (error) {
      if (error.statusCode === 401) wx.reLaunch({ url: "/pages/login/index" });
      this.setData({ loading: false });
    }
  },

  onRange(event) {
    this.setData({ range: event.currentTarget.dataset.range });
    this.rebuild();
  },

  rebuild() {
    const limits = getRange(this.data.range);
    const visible = this.data.transactions.filter((item) => {
      const date = String(item.occurredAt || "").slice(0, 10);
      return date >= limits.start && date <= limits.end;
    });
    const expenseValue = sum(visible, "expense");
    const incomeValue = sum(visible, "income");
    const bars = rangeBars(this.data.range, visible, limits);
    const max = Math.max(1, ...bars.map((item) => Math.max(item.expense, item.income)));
    const categoryMap = groupAmounts(
      visible.filter((item) => item.type === "expense"),
      (item) => item.categoryName || "未分类",
    );
    const memberNames = new Map((this.data.memberSource || []).map((member) => [member.id, member.name]));
    const memberMap = groupAmounts(
      visible.filter((item) => item.type === "expense"),
      (item) => memberNames.get(item.memberId) || "我",
    );
    const decorate = (entries, total) =>
      entries.slice(0, 5).map(([name, value], index) => ({
        name,
        value: currency(value, this.data.book.currency),
        width: `${Math.max(8, Math.round((value / Math.max(1, total)) * 100))}%`,
        color: ["#ff681c", "#ff9160", "#ffb28d", "#f4c3a8", "#d6a98d"][index],
      }));
    const readyBars = bars.map((item) => ({
      ...item,
      expenseHeight: Math.max(4, Math.round((item.expense / max) * 100)),
      incomeHeight: Math.max(4, Math.round((item.income / max) * 100)),
      expenseText: currency(item.expense, this.data.book.currency),
      incomeText: currency(item.income, this.data.book.currency),
    }));
    this.setData({
      expense: currency(expenseValue, this.data.book.currency),
      income: currency(incomeValue, this.data.book.currency),
      bars: readyBars,
      selectedBar: readyBars[0] || null,
      categories: decorate(
        [...categoryMap.entries()].sort((a, b) => b[1] - a[1]),
        expenseValue,
      ),
      members: decorate(
        [...memberMap.entries()].sort((a, b) => b[1] - a[1]),
        expenseValue,
      ),
    });
  },

  onBar(event) {
    this.setData({ selectedBar: this.data.bars[Number(event.currentTarget.dataset.index)] });
  },

  onToggleExpense() {
    this.setData({ showExpense: !this.data.showExpense });
  },

  onToggleIncome() {
    this.setData({ showIncome: !this.data.showIncome });
  },

  onBookTap() {
    const books = getApp().globalData.books || [];
    wx.showActionSheet({
      itemList: books.map((book) => book.name),
      success: ({ tapIndex }) => {
        session.setActiveBook(books[tapIndex].id);
        this.loadPage();
      },
    });
  },
});

function getRange(range) {
  const now = new Date();
  if (range === "year") {
    return { start: ymd(new Date(now.getFullYear(), 0, 1)), end: ymd(new Date(now.getFullYear(), 11, 31)) };
  }
  if (range === "month") {
    return {
      start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  const weekday = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1);
  return {
    start: ymd(monday),
    end: ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)),
  };
}

function rangeBars(range, items, limits) {
  if (range === "year") {
    const year = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, month) =>
      bar(
        `${month + 1}月`,
        items.filter((item) => {
          const date = new Date(item.occurredAt);
          return date.getFullYear() === year && date.getMonth() === month;
        }),
      ),
    );
  }
  const startParts = limits.start.split("-").map(Number);
  const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  const length = range === "week" ? 7 : new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return Array.from({ length }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = ymd(date);
    return bar(
      range === "week" ? labels[index] : `${index + 1}`,
      items.filter((item) => String(item.occurredAt).startsWith(key)),
    );
  });
}

function bar(label, items) {
  return { label, expense: sum(items, "expense"), income: sum(items, "income") };
}

function sum(items, type) {
  return items
    .filter((item) => item.type === type)
    .reduce((total, item) => total + Number(item.amount || 0), 0);
}

function groupAmounts(items, keyFor) {
  const result = new Map();
  items.forEach((item) => {
    const key = keyFor(item);
    result.set(key, (result.get(key) || 0) + Number(item.amount || 0));
  });
  return result;
}
