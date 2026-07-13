import { optionalSession, requireLogin } from "../services/session";

interface TabItem {
  index: number;
  pagePath: string;
  text: string;
  icon: string;
}

interface TabBarData {
  selected: number;
  leftTabs: TabItem[];
  rightTabs: TabItem[];
}

const tabs: TabItem[] = [
  { index: 0, pagePath: "/pages/home/index", text: "首页", icon: "⌂" },
  { index: 1, pagePath: "/pages/records/index", text: "流水", icon: "≡" },
  { index: 2, pagePath: "/pages/analysis/index", text: "分析", icon: "▥" },
  { index: 3, pagePath: "/pages/settings/index", text: "我的", icon: "○" },
];

Component({
  data: {
    selected: 0,
    leftTabs: tabs.slice(0, 2),
    rightTabs: tabs.slice(2),
  } as TabBarData,
  methods: {
    onSwitch(event: DatasetEvent<{ index: string | number }>) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = tabs[index];
      if (!tab || index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: tab.pagePath });
    },
    async onAdd() {
      const state = await optionalSession();
      if (!state) {
        await requireLogin("/pages/record-form/index");
        return;
      }
      const user = state.user;
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
