const api = require("../../services/api");

Page({
  data: { sessionId: "", title: "新会话", messages: [], input: "", sending: false },

  onLoad(options) {
    this.initialPrompt = options.prompt ? decodeURIComponent(options.prompt) : "";
    this.searchMode = options.mode === "search";
    this.createSession();
  },

  async createSession() {
    const book = getApp().globalData.activeBook;
    try {
      const result = await api.request({
        path: "/ai/sessions",
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: { bookId: book && book.id, title: this.searchMode ? "一次性搜索" : "新会话" },
      });
      this.setData({ sessionId: result.session.id, input: this.initialPrompt });
      if (this.initialPrompt) this.onSend();
    } catch (error) {
      wx.showToast({ title: error.message || "AI 会话创建失败", icon: "none" });
    }
  },

  onInput(event) {
    this.setData({ input: event.detail.value });
  },

  async onSend() {
    const text = this.data.input.trim();
    if (!text || !this.data.sessionId || this.data.sending) return;
    const userMessage = { id: `local-${Date.now()}`, role: "user", text };
    this.setData({ messages: [...this.data.messages, userMessage], input: "", sending: true });
    try {
      const book = getApp().globalData.activeBook;
      const result = await api.request({
        path: `/ai/sessions/${this.data.sessionId}/messages`,
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: { message: text, bookId: book && book.id, page: "微信小程序", timeZone: "Asia/Shanghai" },
        timeout: 60000,
      });
      const textParts = (result.parts || [])
        .map((part) => part.text || part.message || part.summary || "")
        .filter(Boolean);
      this.setData({
        title: this.data.title === "新会话" ? text.slice(0, 20) : this.data.title,
        messages: [
          ...this.data.messages,
          {
            id: result.message.id,
            role: "assistant",
            text: textParts.join("\n") || "操作已完成",
            parts: result.parts || [],
          },
        ],
      });
    } catch (error) {
      this.setData({
        messages: [
          ...this.data.messages,
          { id: `error-${Date.now()}`, role: "assistant", text: error.message || "AI 暂时不可用" },
        ],
      });
    } finally {
      this.setData({ sending: false });
      this.scrollToBottom();
    }
  },

  scrollToBottom() {
    this.setData({ anchor: `message-${this.data.messages.length - 1}` });
  },
});
