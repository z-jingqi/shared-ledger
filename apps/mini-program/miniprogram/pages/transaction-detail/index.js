const api = require("../../services/api");
const { currency } = require("../../utils/format");

Page({
  data: { loading: true, transaction: null, permissions: {}, amountText: "" },

  onLoad(options) {
    this.transactionId = options.id;
    this.loadTransaction();
  },

  async loadTransaction() {
    try {
      const result = await api.request({ path: `/transactions/${this.transactionId}` });
      const transaction = result.transaction;
      const book = getApp().globalData.activeBook;
      this.setData({
        loading: false,
        transaction,
        permissions: result.permissions || {},
        amountText: currency(transaction.amount, book && book.currency),
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "记录加载失败", icon: "none" });
    }
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/record-form/index?id=${this.transactionId}` });
  },

  async onDelete() {
    const result = await new Promise((resolve) => {
      wx.showModal({
        title: "删除记录",
        content: "删除后无法恢复，确定继续吗？",
        confirmColor: "#ef5b55",
        success: resolve,
      });
    });
    if (!result.confirm) return;
    try {
      await api.request({ path: `/transactions/${this.transactionId}`, method: "DELETE" });
      wx.showToast({ title: "已删除", icon: "success" });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败", icon: "none" });
    }
  },
});
