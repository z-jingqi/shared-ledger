interface HeaderProperties {
  title: string;
  bookName: string;
  bookMark: string;
  showAi: boolean;
  showBack: boolean;
}

interface HeaderData {
  statusBarHeight: number;
  navigationHeight: number;
}

Component({
  properties: {
    title: { type: String, value: "" },
    bookName: { type: String, value: "" },
    bookMark: { type: String, value: "账" },
    showAi: { type: Boolean, value: false },
    showBack: { type: Boolean, value: false },
  },
  data: {
    statusBarHeight: 20,
    navigationHeight: 44,
  } as HeaderData,
  lifetimes: {
    attached() {
      const chrome = getApp<IAppOption>().globalData.chrome;
      this.setData({
        statusBarHeight: chrome.statusBarHeight || 20,
        navigationHeight: chrome.navigationHeight || 44,
      });
    },
  },
  methods: {
    onBack() {
      wx.navigateBack();
    },
    onBook() {
      this.triggerEvent("booktap");
    },
    onAi() {
      this.triggerEvent("aitap");
    },
  },
});
