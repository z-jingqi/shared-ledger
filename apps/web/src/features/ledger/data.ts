import {
  ChartPieSliceIcon,
  FileArrowUpIcon,
  HouseIcon,
  InfoIcon,
  ListBulletsIcon,
  PlusIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";

export const mainNavigation = [
  { to: "/home", label: "首页", Icon: HouseIcon },
  { to: "/records", label: "记录", Icon: ListBulletsIcon },
  { to: "", label: "添加", Icon: PlusIcon },
  { to: "/analysis", label: "分析", Icon: ChartPieSliceIcon },
  { to: "/settings", label: "我的", Icon: UserCircleIcon },
];

export const settingsLinks = [
  { label: "分类管理", to: "/settings/categories", Icon: ListBulletsIcon },
  { label: "导出数据", to: "/settings/export", Icon: FileArrowUpIcon },
  { label: "关于我们", to: "/settings/about", Icon: InfoIcon },
];
