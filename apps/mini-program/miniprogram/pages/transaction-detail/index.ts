import { request } from "../../services/api";
import { ensure, requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";
import { currency } from "../../utils/format";

interface TransactionPermissions {
  canEdit?: boolean;
  canDelete?: boolean;
}

interface TransactionDetailData {
  loading: boolean;
  transactionId: string;
  transaction: LedgerTransaction | null;
  permissions: TransactionPermissions;
  amountText: string;
}

Page({
  data: {
    loading: true,
    transactionId: "",
    transaction: null,
    permissions: {},
    amountText: "",
  } as TransactionDetailData,

  async onLoad(options: Record<string, string | undefined>) {
    const transactionId = options.id || "";
    if (!(await requireLogin(`/pages/transaction-detail/index?id=${encodeURIComponent(transactionId)}`)))
      return;
    this.setData({ transactionId });
    void this.loadTransaction();
  },

  async loadTransaction() {
    try {
      const result = await request<{ transaction: LedgerTransaction; permissions: TransactionPermissions }>({
        path: `/transactions/${this.data.transactionId}`,
      });
      const transaction = result.transaction;
      const { activeBook: book } = await ensure();
      this.setData({
        loading: false,
        transaction,
        permissions: result.permissions || {},
        amountText: currency(transaction.amount, book?.currency || "CNY"),
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: errorMessage(error, "记录加载失败"), icon: "none" });
    }
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/record-form/index?id=${this.data.transactionId}` });
  },

  async onDelete() {
    const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
      wx.showModal({
        title: "删除记录",
        content: "删除后无法恢复，确定继续吗？",
        confirmColor: "#ef5b55",
        success: resolve,
      });
    });
    if (!result.confirm) return;
    try {
      await request({ path: `/transactions/${this.data.transactionId}`, method: "DELETE" });
      wx.showToast({ title: "已删除", icon: "success" });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "删除失败"), icon: "none" });
    }
  },
});
