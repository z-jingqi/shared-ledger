import { RobotIcon } from "@phosphor-icons/react";
import type { SubscriptionPlan } from "@shared-ledger/shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AiDrawer } from "../components/ai/AiDrawer";
import { mainNavigation } from "../features/ledger/data";

export function AppFrame({ children, plan }: { children: ReactNode; plan: SubscriptionPlan }) {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAuthPage = ["/login", "/register"].includes(location.pathname);

  if (isAuthPage) return <main className="phone auth-shell">{children}</main>;

  return (
    <main className="phone">
      <div className="content">{children}</div>
      {plan === "pro" && (
        <>
          <button className="ai-fab" aria-label="打开 AI 助手" onClick={() => setDrawerOpen(true)}>
            <RobotIcon size={25} weight="fill" />
          </button>
          {drawerOpen && <AiDrawer close={() => setDrawerOpen(false)} />}
        </>
      )}
      <nav className="bottom-nav">
        {mainNavigation.map(({ to, label, Icon }) => {
          const active = location.pathname.startsWith(to);
          return (
            <Link key={to} to={to} className={active ? "active" : ""}>
              <Icon size={23} weight={active ? "fill" : "regular"} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </main>
  );
}
