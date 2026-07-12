const session = require("./services/session");

App({
  globalData: {
    apiOrigin: "https://dev.leger.aleph-cat.com/api",
    user: null,
    books: [],
    activeBook: null,
    chrome: { statusBarHeight: 20, navigationHeight: 44 },
  },

  onLaunch() {
    this.measureChrome();
    session.restore().catch(() => undefined);
  },

  measureChrome() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const navigationHeight = Math.max(44, menu.bottom + menu.top - statusBarHeight * 2);
    this.globalData.chrome = { statusBarHeight, navigationHeight };
  },
});
