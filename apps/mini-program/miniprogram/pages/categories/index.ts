import { request } from "../../services/api";
import { requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

interface CategoriesData {
  type: LedgerTransactionType;
  categories: LedgerCategory[];
  visibleCategories: LedgerCategory[];
  colors: string[];
  selectedColor: string;
}

Page({
  data: {
    type: "expense",
    categories: [],
    visibleCategories: [],
    colors: ["#ff681c", "#ef5b55", "#4c8df6", "#18a35c", "#8f4ff6", "#f5a623"],
    selectedColor: "#ff681c",
  } as CategoriesData,

  async onShow() {
    if (!(await requireLogin("/pages/categories/index"))) return;
    void this.loadCategories();
  },

  async loadCategories() {
    try {
      const result = await request<{ categories: LedgerCategory[] }>({ path: "/me/categories" });
      this.setData({ categories: result.categories || [] });
      this.applyType();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "分类加载失败"), icon: "none" });
    }
  },

  onType(event: DatasetEvent<{ type: LedgerTransactionType }>) {
    this.setData({ type: event.currentTarget.dataset.type });
    this.applyType();
  },

  applyType() {
    this.setData({ visibleCategories: this.data.categories.filter((item) => item.type === this.data.type) });
  },

  onColor(event: DatasetEvent<{ color: string }>) {
    this.setData({ selectedColor: event.currentTarget.dataset.color });
  },

  async onAdd() {
    const result = await editableModal("新增分类", "输入分类名称");
    if (!result.confirm || !result.content.trim()) return;
    try {
      await request({
        path: "/me/categories",
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: { name: result.content.trim(), type: this.data.type, color: this.data.selectedColor },
      });
      await this.loadCategories();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "创建失败"), icon: "none" });
    }
  },

  async onEdit(event: DatasetEvent<{ id: string }>) {
    const category = this.data.categories.find((item) => item.id === event.currentTarget.dataset.id);
    if (!category) return;
    const result = await editableModal("修改分类", "输入分类名称", category.name);
    if (!result.confirm || !result.content.trim()) return;
    try {
      await request({
        path: `/categories/${category.id}`,
        method: "PATCH",
        header: { "Content-Type": "application/json" },
        data: { name: result.content.trim(), color: category.color || this.data.selectedColor },
      });
      await this.loadCategories();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "保存失败"), icon: "none" });
    }
  },

  async onDelete(event: DatasetEvent<{ id: string }>) {
    const id = event.currentTarget.dataset.id;
    const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) =>
      wx.showModal({
        title: "删除分类",
        content: "历史流水会保留并显示为未分类。",
        confirmColor: "#ef5b55",
        success: resolve,
      }),
    );
    if (!result.confirm) return;
    try {
      await request({ path: `/categories/${id}`, method: "DELETE" });
      await this.loadCategories();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "删除失败"), icon: "none" });
    }
  },
});

function editableModal(title: string, placeholderText: string, content = "") {
  return new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) =>
    wx.showModal({
      title,
      editable: true,
      placeholderText,
      content,
      confirmColor: "#ff681c",
      success: resolve,
    }),
  );
}
