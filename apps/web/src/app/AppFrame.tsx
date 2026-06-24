import { RobotIcon } from "@phosphor-icons/react";
import { Button } from "@shared-ledger/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AiDrawer } from "../components/ai/AiDrawer";
import { mainNavigation } from "../features/ledger/data";
import { useAuth } from "../features/auth/AuthProvider";

export function AppFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAuthPage = ["/login", "/register"].includes(location.pathname);
  const isCreateBookPage = location.pathname === "/books/new";
  const bottomNavTab = getBottomNavTab(location.pathname);
  const showBottomNav = bottomNavTab !== null;
  const showAiAssistant = user?.plan === "pro" && showBottomNav;
  const bottomNavigation = [
    {
      to: bottomNavTab === "books" && isBookHomePath(location.pathname) ? location.pathname : "/books",
      label: "账本",
      Icon: mainNavigation[0].Icon,
    },
    { to: "/analysis", label: "统计", Icon: mainNavigation[3].Icon },
    { to: "/settings", label: "我的", Icon: mainNavigation[4].Icon },
  ];

  if (isAuthPage) return <main className="phone auth-shell">{children}</main>;

  const shellClassName = [
    "phone",
    isCreateBookPage ? "create-book-shell" : "",
    showBottomNav ? "has-bottom-nav" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName}>
      <div className="content">{children}</div>
      {showAiAssistant && (
        <>
          <Button
            className="ai-fab"
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开 AI 助手"
            onClick={() => setDrawerOpen(true)}
          >
            <RobotIcon size={25} weight="fill" />
          </Button>
          {drawerOpen && <AiDrawer close={() => setDrawerOpen(false)} />}
        </>
      )}
      {showBottomNav && (
        <nav className="bottom-nav">
          {bottomNavigation.map(({ to, label, Icon }) => {
            const active =
              (label === "账本" && bottomNavTab === "books") ||
              (label === "统计" && bottomNavTab === "analysis") ||
              (label === "我的" && bottomNavTab === "settings");
            return (
              <Link key={to} to={to} className={active ? "active" : ""}>
                <Icon size={23} weight={active ? "fill" : "regular"} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </main>
  );
}

function isBookHomePath(pathname: string) {
  return /^\/books\/(?!new$)[^/]+$/.test(pathname);
}

function getBottomNavTab(pathname: string): "books" | "analysis" | "settings" | null {
  if (pathname === "/books" || isBookHomePath(pathname)) return "books";
  if (pathname === "/analysis") return "analysis";
  if (pathname === "/settings") return "settings";
  return null;
}
