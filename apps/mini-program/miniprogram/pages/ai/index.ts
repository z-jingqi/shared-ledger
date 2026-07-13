import { request } from "../../services/api";
import { ensure, requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

interface AiPart extends Record<string, unknown> {
  text?: string;
  message?: string;
  summary?: string;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  parts?: AiPart[];
}

interface AiData {
  sessionId: string;
  title: string;
  messages: AiMessage[];
  input: string;
  sending: boolean;
  initialPrompt: string;
  searchMode: boolean;
  anchor: string;
}

Page({
  data: {
    sessionId: "",
    title: "新会话",
    messages: [],
    input: "",
    sending: false,
    initialPrompt: "",
    searchMode: false,
    anchor: "",
  } as AiData,

  async onLoad(options: Record<string, string | undefined>) {
    const query = options.prompt
      ? `?mode=${encodeURIComponent(options.mode || "")}&prompt=${encodeURIComponent(options.prompt)}`
      : "";
    if (!(await requireLogin(`/pages/ai/index${query}`))) return;
    this.setData({
      initialPrompt: options.prompt ? decodeURIComponent(options.prompt) : "",
      searchMode: options.mode === "search",
    });
    void this.createSession();
  },

  async createSession() {
    try {
      const { activeBook: book } = await ensure();
      const result = await request<{ session: { id: string } }>({
        path: "/ai/sessions",
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: { bookId: book?.id, title: this.data.searchMode ? "一次性搜索" : "新会话" },
      });
      this.setData({ sessionId: result.session.id, input: this.data.initialPrompt });
      if (this.data.initialPrompt) void this.onSend();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "AI 会话创建失败"), icon: "none" });
    }
  },

  onInput(event: InputEvent) {
    this.setData({ input: event.detail.value });
  },

  async onSend() {
    const messageText = this.data.input.trim();
    if (!messageText || !this.data.sessionId || this.data.sending) return;
    const userMessage: AiMessage = { id: `local-${Date.now()}`, role: "user", text: messageText };
    this.setData({ messages: [...this.data.messages, userMessage], input: "", sending: true });
    try {
      const { activeBook: book } = await ensure();
      const result = await request<{ message: { id: string }; parts: AiPart[] }>({
        path: `/ai/sessions/${this.data.sessionId}/messages`,
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: {
          message: messageText,
          bookId: book?.id,
          page: "微信小程序",
          timeZone: "Asia/Shanghai",
        },
        timeout: 60000,
      });
      const textParts = (result.parts || [])
        .map((part) => part.text || part.message || part.summary || "")
        .filter(Boolean);
      const assistantMessage: AiMessage = {
        id: result.message.id,
        role: "assistant",
        text: textParts.join("\n") || "操作已完成",
        parts: result.parts || [],
      };
      this.setData({
        title: this.data.title === "新会话" ? messageText.slice(0, 20) : this.data.title,
        messages: [...this.data.messages, assistantMessage],
      });
    } catch (error) {
      const assistantMessage: AiMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        text: errorMessage(error, "AI 暂时不可用"),
      };
      this.setData({ messages: [...this.data.messages, assistantMessage] });
    } finally {
      this.setData({ sending: false });
      this.scrollToBottom();
    }
  },

  scrollToBottom() {
    this.setData({ anchor: `message-${this.data.messages.length - 1}` });
  },
});
