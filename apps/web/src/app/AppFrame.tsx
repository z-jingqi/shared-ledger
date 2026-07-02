import { ChartBarIcon, HouseIcon, ListBulletsIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, type Location } from "react-router-dom";
import { toast } from "sonner";
import {
  ImportFileUploadInput,
  type ImportFileUploadInputHandle,
} from "../components/imports/ImportFileUploadInput";
import { useAuth } from "../features/auth/AuthProvider";
import { useInvitationBadge } from "../features/invitations/useInvitationBadge";
import { AppSheetHost } from "../features/sheets/AppSheetHost";
import { AppSheetProvider, useAppSheetActions } from "../features/sheets/SheetContext";
import { useActiveBook } from "../hooks/useActiveBook";
import { AddActionMenu } from "./AddActionMenu";

const tabs = [
  { to: "/home", label: "首页", id: "home", Icon: HouseIcon },
  { to: "/records", label: "流水", id: "records", Icon: ListBulletsIcon },
  { to: "/analysis", label: "分析", id: "analysis", Icon: ChartBarIcon },
  { to: "/settings", label: "我的", id: "settings", Icon: UserCircleIcon },
] as const;

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <AppSheetProvider>
      <AppFrameInner>{children}</AppFrameInner>
    </AppSheetProvider>
  );
}

function AppFrameInner({ children }: { children: ReactNode }) {
  const routerLocation = useLocation();
  const { user } = useAuth();
  const { book } = useActiveBook();
  const { openSheet } = useAppSheetActions();
  const { unreadCount: invitationBadge } = useInvitationBadge(user?.id);
  const uploadInputRef = useRef<ImportFileUploadInputHandle>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const routeState = routerLocation.state as { backgroundLocation?: Location } | null;
  const backgroundLocation = routeState?.backgroundLocation ?? routerLocation;
  const shellPathname = backgroundLocation.pathname;
  const isAuthPage = ["/login", "/register"].includes(routerLocation.pathname);
  const isCreateBookPage = routerLocation.pathname === "/books/new";
  const bottomNavTab = getBottomNavTab(shellPathname);
  const showBottomNav = Boolean(
    user && bottomNavTab && !isAuthPage && !isCreateBookPage && shellPathname !== "/ai",
  );
  const canUseImageRecognition = user?.plan === "pro";
  const bookQuery = book?.id ? `?bookId=${encodeURIComponent(book.id)}` : "";

  useEffect(() => {
    setAddMenuOpen(false);
  }, [routerLocation.pathname, routerLocation.search]);

  const goToManualAdd = () => {
    if (!book?.id) {
      toast.error("请先选择账本", { duration: 3000, closeButton: true });
      return;
    }
    setAddMenuOpen(false);
    openSheet({ type: "record-form", initialType: "expense" });
  };

  const openUploadInput = () => {
    uploadInputRef.current?.open();
    setAddMenuOpen(false);
  };

  if (isAuthPage) return <main className="phone auth-shell ios-auth-shell">{children}</main>;

  return (
    <main
      className={`phone ios-app-shell${showBottomNav ? " has-bottom-nav" : ""}${isCreateBookPage ? " create-book-shell" : ""}`}
    >
      <div className="content ios-app-content">{children}</div>
      {showBottomNav && (
        <>
          <nav className="ios-bottom-nav" aria-label="主导航">
            <div className="ios-bottom-nav-group">
              {tabs.slice(0, 2).map((tab) => (
                <BottomTab key={tab.id} {...tab} active={bottomNavTab === tab.id} bookQuery={bookQuery} />
              ))}
            </div>
            <span className="ios-bottom-nav-spacer" aria-hidden="true" />
            <div className="ios-bottom-nav-group">
              {tabs.slice(2).map((tab) => (
                <BottomTab
                  key={tab.id}
                  {...tab}
                  active={bottomNavTab === tab.id}
                  badge={tab.id === "settings" ? invitationBadge : 0}
                  bookQuery={bookQuery}
                />
              ))}
            </div>
          </nav>
          {canUseImageRecognition ? (
            <ImportFileUploadInput
              ref={uploadInputRef}
              bookId={book?.id}
              onUploadingChange={setUploading}
              onUploaded={() => openSheet({ type: "imports" })}
            />
          ) : null}
          <AddActionMenu
            directManual={!canUseImageRecognition}
            open={addMenuOpen}
            showUpload={canUseImageRecognition}
            uploading={uploading}
            onManualAdd={goToManualAdd}
            onOpenChange={setAddMenuOpen}
            onUploadFile={openUploadInput}
          />
        </>
      )}
      <AppSheetHost bookId={book?.id} currency={book?.currency} />
    </main>
  );
}

function BottomTab({
  to,
  label,
  active,
  badge = 0,
  Icon,
  bookQuery,
}: {
  to: string;
  label: string;
  active: boolean;
  badge?: number;
  Icon: (props: { size?: number; weight?: "regular" | "fill"; "aria-hidden"?: boolean }) => ReactNode;
  bookQuery: string;
}) {
  return (
    <Link
      className={`ios-bottom-tab${active ? " active" : ""}`}
      to={`${to}${bookQuery}`}
      aria-current={active ? "page" : undefined}
    >
      <span className="ios-bottom-tab-icon">
        <Icon size={24} weight={active ? "fill" : "regular"} aria-hidden />
        {badge > 0 ? <em>{badge > 9 ? "9+" : badge}</em> : null}
      </span>
      <span>{label}</span>
    </Link>
  );
}

function getBottomNavTab(pathname: string): "home" | "records" | "analysis" | "settings" | null {
  if (pathname.startsWith("/books/manage") || /^\/books\/[^/]+\/settings/.test(pathname)) return "settings";
  if (pathname === "/" || pathname.startsWith("/home") || pathname.startsWith("/books/")) return "home";
  if (pathname.startsWith("/records") || pathname.startsWith("/imports")) return "records";
  if (pathname.startsWith("/analysis")) return "analysis";
  if (
    pathname.startsWith("/settings") ||
    pathname.startsWith("/members") ||
    pathname.startsWith("/invitations") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/subscription")
  )
    return "settings";
  return null;
}
