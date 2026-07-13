type LedgerPlan = "free" | "pro";
type LedgerTransactionType = "expense" | "income";

interface LedgerUser {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  plan: LedgerPlan;
}

interface LedgerBook {
  id: string;
  name: string;
  currency: string;
  incomeEnabled: boolean;
}

interface LedgerCategory {
  id: string;
  name: string;
  type: LedgerTransactionType;
  color?: string;
}

interface LedgerTransactionItem {
  id?: string;
  name: string;
  amount: number;
  categoryId?: string;
  note?: string;
}

interface LedgerTransaction {
  id: string;
  bookId?: string;
  type: LedgerTransactionType;
  amount: number;
  categoryId?: string;
  categoryName?: string;
  memberId?: string;
  note?: string;
  occurredAt: string;
  items?: LedgerTransactionItem[];
}

interface MiniProgramChrome {
  statusBarHeight: number;
  navigationHeight: number;
}

interface MiniProgramGlobalData {
  apiOrigin: string;
  user: LedgerUser | null;
  books: LedgerBook[];
  activeBook: LedgerBook | null;
  chrome: MiniProgramChrome;
}

interface IAppOption {
  globalData: MiniProgramGlobalData;
  measureChrome(): void;
}

interface ApiError extends Error {
  statusCode?: number;
}

interface ApiRequestOptions {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
  auth?: boolean;
}

interface ApiUploadOptions {
  path: string;
  filePath: string;
  method?: "POST" | "PUT";
  name?: string;
  filename?: string;
  formData?: Record<string, string>;
}

type InputEvent = WechatMiniprogram.Input;
type DatasetEvent<T extends WechatMiniprogram.IAnyObject = WechatMiniprogram.IAnyObject> =
  WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, T>;
