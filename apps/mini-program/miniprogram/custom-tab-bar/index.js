Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: "/pages/home/index", text: "首页", icon: "⌂" },
      { pagePath: "/pages/records/index", text: "流水", icon: "≡" },
      { pagePath: "/pages/analysis/index", text: "分析", icon: "▥" },
      { pagePath: "/pages/settings/index", text: "我的", icon: "○" },
    ],
  },
  methods: {
    onSwitch(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: tab.pagePath });
    },
    onAdd() {
      const user = getApp().globalData.user;
      const items =
        user && user.plan === "pro" ? ["手动记账", "图片识别", "AI 助手"] : ["手动记账", "AI 助手"];
      wx.showActionSheet({
        itemList: items,
        success: ({ tapIndex }) => {
          const action = items[tapIndex];
          const url =
            action === "图片识别"
              ? "/pages/imports/index"
              : action === "AI 助手"
                ? "/pages/ai/index"
                : "/pages/record-form/index";
          wx.navigateTo({ url });
        },
      });
    },
  },
});
