import { RobotIcon } from "@phosphor-icons/react";
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
  const isBookHome = /^\/books\/[^/]+$/.test(location.pathname);
  const showBottomNav = isBookHome || location.pathname === "/analysis";
  const bottomNavigation = [
    { to: isBookHome ? location.pathname : "/books", label: "账本", Icon: mainNavigation[0].Icon },
    { to: "/analysis", label: "统计", Icon: mainNavigation[3].Icon },
    { to: "/settings", label: "我的", Icon: mainNavigation[4].Icon },
  ];

  if (isAuthPage) return <main className="phone auth-shell">{children}</main>;

  return (
    <main className="phone">
      <div className="content">{children}</div>
      {user?.plan === "pro" && (
        <>
          <button className="ai-fab" aria-label="打开 AI 助手" onClick={() => setDrawerOpen(true)}>
            <RobotIcon size={25} weight="fill" />
          </button>
          {drawerOpen && <AiDrawer close={() => setDrawerOpen(false)} />}
        </>
      )}
      {showBottomNav && (
        <nav className="bottom-nav">
          {bottomNavigation.map(({ to, label, Icon }) => {
            const active =
              (label === "账本" && isBookHome) ||
              (label === "统计" && location.pathname === "/analysis") ||
              (label === "我的" && location.pathname === "/settings");
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
