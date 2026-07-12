const api = require("./api");

const ACTIVE_BOOK_KEY = "shared-ledger:mini-active-book";

function applyState(user, books) {
  const app = getApp();
  const storedId = wx.getStorageSync(ACTIVE_BOOK_KEY);
  const activeBook = books.find((book) => book.id === storedId) || books[0] || null;
  app.globalData.user = user || null;
  app.globalData.books = books;
  app.globalData.activeBook = activeBook;
  return { user, books, activeBook };
}

async function restore() {
  const me = await api.request({ path: "/auth/me" });
  const result = await api.request({ path: "/books" });
  return applyState(me.user, result.books || []);
}

async function login(identifier, password) {
  const result = await api.request({
    path: "/auth/login",
    method: "POST",
    auth: false,
    header: { "Content-Type": "application/json" },
    data: { identifier, password },
  });
  const books = await api.request({ path: "/books" });
  return applyState(result.user, books.books || []);
}

async function logout() {
  try {
    await api.request({ path: "/auth/logout", method: "POST" });
  } finally {
    api.clearSession();
    applyState(null, []);
  }
}

function setActiveBook(bookId) {
  const app = getApp();
  const activeBook = app.globalData.books.find((book) => book.id === bookId) || null;
  if (!activeBook) return null;
  wx.setStorageSync(ACTIVE_BOOK_KEY, bookId);
  app.globalData.activeBook = activeBook;
  return activeBook;
}

module.exports = { login, logout, restore, setActiveBook };
