import { request, upload } from "../../services/api";
import { ensure, requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

type ImportFilter = "all" | "processing" | "success" | "failed";

interface ImportJob {
  id: string;
  status: string;
  fileName?: string;
  errorMessage?: string;
}

interface ImportUsage extends Record<string, unknown> {
  imageOcr: { remaining: number };
}

interface ImportData {
  filter: ImportFilter;
  jobs: ImportJob[];
  visibleJobs: ImportJob[];
  loading: boolean;
  uploading: boolean;
  remaining: number;
}

Page({
  data: {
    filter: "all",
    jobs: [],
    visibleJobs: [],
    loading: true,
    uploading: false,
    remaining: 0,
  } as ImportData,

  async onShow() {
    const state = await requireLogin("/pages/imports/index");
    if (!state) return;
    const user = state.user;
    if (!user || user.plan !== "pro") {
      wx.showToast({ title: "当前套餐不显示图片识别入口", icon: "none" });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    this.loadJobs();
  },

  async loadJobs() {
    const { activeBook: book } = await ensure();
    if (!book) return;
    this.setData({ loading: true });
    try {
      const [jobResult, usageResult] = await Promise.all([
        request<{ imports: ImportJob[] }>({ path: `/books/${book.id}/imports` }),
        request<ImportUsage>({ path: "/me/import-usage" }),
      ]);
      this.setData({
        jobs: jobResult.imports || [],
        remaining: usageResult.imageOcr.remaining,
        loading: false,
      });
      this.applyFilter();
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: errorMessage(error, "任务加载失败"), icon: "none" });
    }
  },

  onFilter(event: DatasetEvent<{ filter: ImportFilter }>) {
    this.setData({ filter: event.currentTarget.dataset.filter });
    this.applyFilter();
  },

  applyFilter() {
    const filter = this.data.filter;
    const terminal = { success: ["completed", "pending_confirmation"], failed: ["failed", "cancelled"] };
    this.setData({
      visibleJobs:
        filter === "all"
          ? this.data.jobs
          : filter === "processing"
            ? this.data.jobs.filter((job) => ![...terminal.success, ...terminal.failed].includes(job.status))
            : this.data.jobs.filter((job) => terminal[filter as "success" | "failed"].includes(job.status)),
    });
  },

  onChoose() {
    if (!this.data.remaining) {
      wx.showToast({ title: "今日图片识别额度已用完", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: Math.min(5, this.data.remaining),
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: ({ tempFiles }) => this.uploadFiles(tempFiles),
    });
  },

  async uploadFiles(files: WechatMiniprogram.MediaFile[]) {
    const { activeBook: book } = await ensure();
    if (!book) return;
    this.setData({ uploading: true });
    try {
      for (const file of files) {
        await upload({
          path: `/books/${book.id}/imports`,
          filePath: file.tempFilePath,
          formData: { autoConfirm: "false" },
        });
      }
      wx.showToast({ title: "已开始识别", icon: "success" });
      await this.loadJobs();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "上传失败"), icon: "none" });
    } finally {
      this.setData({ uploading: false });
    }
  },
});
