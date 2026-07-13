import { request } from "../../services/api";
import { ensure, requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

interface Member {
  id: string;
  name: string;
  role?: string;
  initial: string;
}

interface Invitation {
  id: string;
  status: string;
  bookName?: string;
}

interface MembersData {
  members: Member[];
  invitations: Invitation[];
  loading: boolean;
}

Page({
  data: { members: [], invitations: [], loading: true } as MembersData,

  async onShow() {
    if (!(await requireLogin("/pages/members/index"))) return;
    void this.loadPage();
  },

  async loadPage() {
    const { activeBook: book } = await ensure();
    if (!book) return;
    try {
      const [members, invitations] = await Promise.all([
        request<{ members: Omit<Member, "initial">[] }>({ path: `/books/${book.id}/members` }),
        request<{ invitations: Invitation[] }>({ path: "/invitations/received" }),
      ]);
      this.setData({
        members: (members.members || []).map((member) => ({
          ...member,
          initial: member.name ? member.name.slice(0, 1) : "成",
        })),
        invitations: invitations.invitations || [],
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: errorMessage(error, "成员加载失败"), icon: "none" });
    }
  },

  async onAccept(event: DatasetEvent<{ id: string }>) {
    try {
      await request({
        path: `/invitations/${event.currentTarget.dataset.id}/accept`,
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: {},
      });
      wx.showToast({ title: "已加入账本", icon: "success" });
      await this.loadPage();
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "接受失败"), icon: "none" });
    }
  },
});
