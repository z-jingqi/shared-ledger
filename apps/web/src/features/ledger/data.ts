import {
  ChartPieSliceIcon,
  FileArrowUpIcon,
  GearIcon,
  HouseIcon,
  ListBulletsIcon,
  SparkleIcon,
  UserCircleIcon,
  UsersIcon,
  WalletIcon,
} from "@phosphor-icons/react";

export const mainNavigation = [
  { to: "/books", label: "账本", Icon: HouseIcon },
  { to: "/records", label: "记录", Icon: ListBulletsIcon },
  { to: "/imports", label: "导入", Icon: FileArrowUpIcon },
  { to: "/analysis", label: "分析", Icon: ChartPieSliceIcon },
  { to: "/settings", label: "我的", Icon: UserCircleIcon },
];

export const settingsLinks = [
  { label: "成员管理", to: "/members", Icon: UsersIcon },
  { label: "分类管理", to: "/settings/categories", Icon: ListBulletsIcon },
  { label: "标签管理", to: "/settings/tags", Icon: SparkleIcon },
  { label: "账户管理", to: "/settings/accounts", Icon: WalletIcon },
  { label: "导出数据", to: "/settings/export", Icon: FileArrowUpIcon },
  { label: "隐私设置", to: "/settings/privacy", Icon: GearIcon },
];
