const api = require("../../services/api");
const { ymd } = require("../../utils/format");

Page({
  data: {
    type: "expense",
    amount: "0",
    note: "",
    date: ymd(new Date()),
    categories: [],
    categoryId: "",
    saving: false,
    title: "记一笔",
    items: [],
    keys: ["1", "2", "3", "⌫", "4", "5", "6", "+", "7", "8", "9", ".", "0", "00"],
  },

  onLoad(options) {
    this.editingId = options.id || "";
    if (this.editingId) {
      this.setData({ title: "编辑记录" });
      this.loadTransaction();
    }
    this.loadCategories();
  },

  async loadTransaction() {
    try {
      const result = await api.request({ path: `/transactions/${this.editingId}` });
      const transaction = result.transaction;
      this.setData({
        type: transaction.type,
        amount: String(transaction.amount),
        note: transaction.note || "",
        date: String(transaction.occurredAt).slice(0, 10),
        categoryId: transaction.categoryId || "",
        items: transaction.items || [],
      });
      this.applyType();
    } catch (error) {
      wx.showToast({ title: error.message || "记录加载失败", icon: "none" });
    }
  },

  async loadCategories() {
    try {
      const result = await api.request({ path: "/me/categories" });
      this.setData({ categorySource: result.categories || [] });
      this.applyType();
    } catch (error) {
      wx.showToast({ title: error.message || "分类加载失败", icon: "none" });
    }
  },

  onType(event) {
    this.setData({ type: event.currentTarget.dataset.type, categoryId: "" });
    this.applyType();
  },

  applyType() {
    this.setData({
      categories: (this.data.categorySource || []).filter((item) => item.type === this.data.type),
    });
  },

  onCategory(event) {
    this.setData({ categoryId: event.currentTarget.dataset.id });
  },

  onKey(event) {
    const key = event.currentTarget.dataset.key;
    let amount = this.data.amount;
    if (key === "⌫") amount = amount.length > 1 ? amount.slice(0, -1) : "0";
    else if (key === "+") return;
    else if (key === "." && amount.includes(".")) return;
    else if (amount === "0" && key !== ".") amount = key;
    else amount += key;
    if (amount.includes(".")) {
      const decimals = amount.split(".")[1] || "";
      if (decimals.length > 2) return;
    }
    this.setData({ amount });
  },

  onNote(event) {
    this.setData({ note: event.detail.value });
  },

  onDate(event) {
    this.setData({ date: event.detail.value });
  },

  onAddItem() {
    wx.showModal({
      title: "添加明细",
      editable: true,
      placeholderText: "例如：咖啡 25",
      confirmColor: "#ff681c",
      success: ({ confirm, content }) => {
        if (!confirm) return;
        const match = String(content || "")
          .trim()
          .match(/^(.*?)\s+(\d+(?:\.\d{1,2})?)$/);
        if (!match || !Number(match[2])) {
          wx.showToast({ title: "请按“名称 金额”输入", icon: "none" });
          return;
        }
        const items = [
          ...this.data.items,
          { id: `local-${Date.now()}`, name: match[1], amount: Number(match[2]) },
        ];
        const amount = items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2);
        this.setData({ items, amount });
      },
    });
  },

  onRemoveItem(event) {
    const items = this.data.items.filter((_, index) => index !== Number(event.currentTarget.dataset.index));
    const amount = items.length
      ? items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)
      : this.data.amount;
    this.setData({ items, amount });
  },

  async onSave() {
    const book = getApp().globalData.activeBook;
    const amount = Number(this.data.amount);
    if (!book || !amount) {
      wx.showToast({ title: "请输入金额", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      await api.request({
        path: this.editingId ? `/transactions/${this.editingId}` : `/books/${book.id}/transactions`,
        method: this.editingId ? "PATCH" : "POST",
        header: { "Content-Type": "application/json" },
        data: {
          type: this.data.type,
          amount,
          occurredAt: this.data.date,
          note: this.data.note.trim() || undefined,
          categoryId: this.data.categoryId || undefined,
          items: this.data.items.map(({ name, amount, categoryId, note }) => ({
            name,
            amount,
            categoryId: categoryId || undefined,
            note: note || undefined,
          })),
        },
      });
      wx.showToast({ title: "已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
});
