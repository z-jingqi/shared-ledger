import { DotsThreeIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

export type AiSession = {
  id: string;
  title: string;
  bookId?: string;
  createdAt: string;
  updatedAt: string;
};

export function AiSessionDirectory({
  activeSessionId,
  onClose,
  onDelete,
  onNewSession,
  onSelectSession,
  sessions,
}: {
  activeSessionId?: string;
  onClose: () => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  sessions: AiSession[];
}) {
  const [menuSessionId, setMenuSessionId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!menuSessionId) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".ios-ai-session-menu")) return;
      if (target.closest("[data-ai-session-menu-trigger='true']")) return;
      setMenuSessionId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuSessionId(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuSessionId]);

  return (
    <div className="ios-ai-session-sheet-layer open">
      <button
        className="ios-ai-session-sheet-backdrop"
        type="button"
        aria-label="关闭会话列表"
        onClick={onClose}
      />
      <aside className="ios-ai-session-sheet" aria-label="AI 会话列表">
        <header>
          <b>会话</b>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <XIcon size={18} weight="bold" />
          </button>
        </header>
        <button className="ios-ai-session-new" type="button" onClick={onNewSession}>
          <PlusIcon size={17} weight="bold" />
          新会话
        </button>
        <menu className="ios-ai-session-sheet-list">
          {sessions.length ? (
            sessions.map((session) => (
              <li
                className={`ios-ai-session-row${session.id === activeSessionId ? " active" : ""}`}
                key={session.id}
              >
                <button
                  className="ios-ai-session-select"
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                >
                  <b>{session.title || "新会话"}</b>
                  <small>{formatSessionTime(session.updatedAt)}</small>
                </button>
                <button
                  className="ios-ai-session-row-icon"
                  type="button"
                  aria-label="会话更多操作"
                  aria-expanded={menuSessionId === session.id}
                  data-ai-session-menu-trigger="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuSessionId((current) => (current === session.id ? undefined : session.id));
                  }}
                >
                  <DotsThreeIcon size={20} weight="bold" />
                </button>
                {menuSessionId === session.id && (
                  <div className="ios-ai-session-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuSessionId(undefined);
                        onDelete(session.id);
                      }}
                    >
                      <TrashIcon size={16} weight="bold" />
                      删除
                    </button>
                  </div>
                )}
              </li>
            ))
          ) : (
            <p className="ios-ai-session-empty">暂无会话</p>
          )}
        </menu>
      </aside>
    </div>
  );
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
