import {
  BriefcaseIcon,
  CarIcon,
  ChartPieSliceIcon,
  FileArrowUpIcon,
  ForkKnifeIcon,
  GearIcon,
  HouseIcon,
  ListBulletsIcon,
  ShoppingCartIcon,
  SparkleIcon,
  UserCircleIcon,
  UsersIcon,
  WalletIcon,
} from "@phosphor-icons/react";

export type TransactionIcon = "cart" | "meal" | "income" | "car";

export type TransactionPreview = {
  id: string;
  title: string;
  note: string;
  amount: number;
  type: "income" | "expense";
  icon: TransactionIcon;
  member: string;
  date: string;
};

export const transactions: TransactionPreview[] = [
  {
    id: "tx_market",
    title: "超市购物",
    note: "日常食材采购",
    amount: 158.6,
    type: "expense",
    icon: "cart",
    member: "张三",
    date: "06-20",
  },
  {
    id: "tx_dinner",
    title: "晚餐聚餐",
    note: "和朋友聚餐",
    amount: 236,
    type: "expense",
    icon: "meal",
    member: "李四",
    date: "06-19",
  },
  {
    id: "tx_salary",
    title: "工资收入",
    note: "6 月工资",
    amount: 8500,
    type: "income",
    icon: "income",
    member: "张三",
    date: "06-18",
  },
  {
    id: "tx_fuel",
    title: "加油费",
    note: "周末出行",
    amount: 320,
    type: "expense",
    icon: "car",
    member: "张三",
    date: "06-17",
  },
];

export const transactionIcons = {
  cart: ShoppingCartIcon,
  meal: ForkKnifeIcon,
  income: BriefcaseIcon,
  car: CarIcon,
};

export const mainNavigation = [
  { to: "/books/book_home", label: "账本", Icon: HouseIcon },
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
