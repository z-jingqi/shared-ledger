import {
  ChartPieSliceIcon,
  BellIcon,
  FileArrowUpIcon,
  GearIcon,
  HouseIcon,
  InfoIcon,
  ListBulletsIcon,
  TagIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";

export const mainNavigation = [
  { to: "/books", label: "账本", Icon: HouseIcon },
  { to: "/records", label: "记录", Icon: ListBulletsIcon },
  { to: "/imports", label: "导入", Icon: FileArrowUpIcon },
  { to: "/analysis", label: "分析", Icon: ChartPieSliceIcon },
  { to: "/settings", label: "我的", Icon: UserCircleIcon },
];

export const settingsLinks = [
  { label: "分类管理", to: "/settings/categories", Icon: ListBulletsIcon },
  { label: "标签管理", to: "/settings/tags", Icon: TagIcon },
  { label: "导出数据", to: "/settings/export", Icon: FileArrowUpIcon },
  { label: "隐私设置", to: "/settings/privacy", Icon: GearIcon },
  { label: "通知设置", to: "/settings/notifications", Icon: BellIcon },
  { label: "关于我们", to: "/settings/about", Icon: InfoIcon },
];
