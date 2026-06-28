import { CheckIcon, DotsThreeIcon, ListIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { AiChat } from "../components/ai/AiChat";
import { IosSheet } from "../components/ios/IosDesign";
import { useActiveBook } from "../hooks/useActiveBook";
import { api } from "../lib";

type AiSession = {
  id: string;
  title: string;
  bookId?: string;
  createdAt: string;
  updatedAt: string;
};

type SessionMenuPosition = {
  top: number;
  right: number;
};

export function AiPage() {
  const { book } = useActiveBook();
  return <Navigate to={book ? `/home?bookId=${book.id}` : "/home"} replace />;
}

export function AiSheet({ onClose }: { onClose: () => void }) {
  const { book } = useActiveBook();
  const sessionSheetRef = useRef<HTMLElement | null>(null);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [showSessions, setShowSessions] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [menuSessionId, setMenuSessionId] = useState<string | undefined>();
  const [menuPosition, setMenuPosition] = useState<SessionMenuPosition | undefined>();
  const [renamingSessionId, setRenamingSessionId] = useState<string | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  );
  const visibleSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(query));
  }, [sessionQuery, sessions]);
  const menuSession = useMemo(() => sessions.find((session) => session.id === menuSessionId), [menuSessionId, sessions]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ sessions: AiSession[] }>("/ai/sessions")
      .then(async (result) => {
        if (!alive) return;
        if (result.sessions.length) {
          setSessions(result.sessions);
          setActiveSessionId((current) => current ?? result.sessions[0].id);
          return;
        }
        const created = await api<{ session: AiSession }>("/ai/sessions", {
          method: "POST",
          body: JSON.stringify({ bookId: book?.id, title: "新会话" }),
        });
        if (!alive) return;
        setSessions([created.session]);
        setActiveSessionId(created.session.id);
      })
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "读取 AI 会话失败", { duration: 3000, closeButton: true }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [book?.id]);

  const startNewSession = async () => {
    try {
      const result = await api<{ session: AiSession }>("/ai/sessions", {
        method: "POST",
        body: JSON.stringify({ bookId: book?.id, title: "新会话" }),
      });
      setSessions((current) => [result.session, ...current].slice(0, 20));
      setActiveSessionId(result.session.id);
      setMenuSessionId(undefined);
      setMenuPosition(undefined);
      setShowSessions(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "创建会话失败", { duration: 3000, closeButton: true });
    }
  };

  const clearCurrentSession = async () => {
    if (!activeSession) return;
    await deleteSession(activeSession.id, true);
    await startNewSession();
    setClearSignal((value) => value + 1);
  };

  const updateSessionActivity = useCallback((detail: { title?: string; hasMessages?: boolean }) => {
    if (!detail.title) return;
    setSessions((current) =>
      current.map((session) =>
        session.id === activeSessionId
          ? { ...session, title: detail.title || (detail.hasMessages ? session.title : "新会话"), updatedAt: new Date().toISOString() }
          : session,
      ),
    );
  }, [activeSessionId]);

  const beginRenameSession = (session: AiSession) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
    setMenuSessionId(undefined);
    setMenuPosition(undefined);
  };

  const saveRenameSession = async () => {
    const title = renameValue.trim();
    if (!renamingSessionId || !title) return;
    try {
      const result = await api<{ session: AiSession }>(`/ai/sessions/${renamingSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.slice(0, 40) }),
      });
      setSessions((current) => current.map((session) => (session.id === result.session.id ? result.session : session)));
      setRenamingSessionId(undefined);
      setRenameValue("");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "重命名失败", { duration: 3000, closeButton: true });
    }
  };

  const deleteSession = async (sessionId: string, silent = false) => {
    try {
      await api(`/ai/sessions/${sessionId}`, { method: "DELETE" });
      setMenuSessionId(undefined);
      setMenuPosition(undefined);
      setRenamingSessionId(undefined);
      setSessions((current) => {
        const next = current.filter((session) => session.id !== sessionId);
        if (activeSessionId === sessionId) setActiveSessionId(next[0]?.id);
        return next;
      });
      if (!silent) toast.success("会话已删除", { duration: 2200, closeButton: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除会话失败", { duration: 3000, closeButton: true });
    }
  };

  const closeSessionSheet = () => {
    setShowSessions(false);
    setMenuSessionId(undefined);
    setMenuPosition(undefined);
  };

  const closeSessionMenu = useCallback(() => {
    setMenuSessionId(undefined);
    setMenuPosition(undefined);
  }, []);

  const toggleSessionMenu = (sessionId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (menuSessionId === sessionId) {
      closeSessionMenu();
      return;
    }
    const sheetRect = sessionSheetRef.current?.getBoundingClientRect();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    if (sheetRect) {
      const menuHeight = 124;
      const top = Math.min(
        Math.max(buttonRect.top - sheetRect.top + 18, 74),
        Math.max(sheetRect.height - menuHeight - 72, 74),
      );
      setMenuPosition({
        top,
        right: Math.max(sheetRect.right - buttonRect.right + 2, 16),
      });
    } else {
      setMenuPosition({ top: 120, right: 18 });
    }
    setMenuSessionId(sessionId);
  };

  useEffect(() => {
    if (!menuSessionId) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".ios-ai-session-menu")) return;
      if (target.closest("[data-ai-session-menu-trigger='true']")) return;
      closeSessionMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSessionMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeSessionMenu, menuSessionId]);

  const sheetTitle = truncateTitle(activeSession?.title || "新会话");

  return (
    <IosSheet
      title={sheetTitle}
      className="ios-ai-workspace"
      full
      onClose={onClose}
      hideGrabber
      disableDragClose
      disableBackdropClose
      left={
        <button className="ios-ai-session-trigger" type="button" aria-label="切换 AI 会话" onClick={() => setShowSessions(true)}>
          <ListIcon size={20} weight="bold" />
        </button>
      }
      right={
        <button className="ios-ai-close-button" type="button" aria-label="关闭 AI 助手" onClick={onClose}>
          <XIcon size={20} weight="bold" />
        </button>
      }
    >
      {showSessions && (
        <div className="ios-ai-session-sheet-layer open">
          <button className="ios-ai-session-sheet-backdrop" type="button" aria-label="关闭会话目录" onClick={closeSessionSheet} />
          <aside className="ios-ai-session-sheet" aria-label="AI 会话目录" ref={sessionSheetRef}>
            <header>
              <span>
                <b>会话</b>
                <small>切换、重命名或删除</small>
              </span>
              <button type="button" aria-label="关闭" onClick={closeSessionSheet}>
                <XIcon size={18} weight="bold" />
              </button>
            </header>
            <button className="ios-ai-session-new" type="button" onClick={() => void startNewSession()}>
              <PlusIcon size={17} weight="bold" />
              新会话
            </button>
            <label className="ios-ai-session-search">
              <MagnifyingGlassIcon size={16} weight="bold" />
              <input value={sessionQuery} onChange={(event) => setSessionQuery(event.currentTarget.value)} placeholder="搜索会话" />
            </label>
            <div className="ios-ai-session-sheet-list" role="list" onScroll={closeSessionMenu}>
              {visibleSessions.length ? visibleSessions.map((session) => (
                <div className={`ios-ai-session-row${session.id === activeSession?.id ? " active" : ""}`} role="listitem" key={session.id}>
                  {renamingSessionId === session.id ? (
                    <label>
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveRenameSession();
                          if (event.key === "Escape") setRenamingSessionId(undefined);
                        }}
                        autoFocus
                      />
                    </label>
                  ) : (
                    <button
                      className="ios-ai-session-select"
                      type="button"
                      onClick={() => {
                        closeSessionMenu();
                        setActiveSessionId(session.id);
                        setShowSessions(false);
                      }}
                    >
                      <b>{session.title || "新会话"}</b>
                      <small>{formatSessionTime(session.updatedAt)}</small>
                    </button>
                  )}
                  {renamingSessionId === session.id ? (
                    <button className="ios-ai-session-row-icon" type="button" aria-label="保存名称" onClick={() => void saveRenameSession()}>
                      <CheckIcon size={17} weight="bold" />
                    </button>
                  ) : (
                    <button
                      className="ios-ai-session-row-icon"
                      type="button"
                      aria-label="会话更多操作"
                      aria-expanded={menuSessionId === session.id}
                      data-ai-session-menu-trigger="true"
                      onClick={(event) => toggleSessionMenu(session.id, event)}
                    >
                      <DotsThreeIcon size={20} weight="bold" />
                    </button>
                  )}
                </div>
              )) : <p className="ios-ai-session-empty">没有找到相关会话</p>}
            </div>
            {menuSession && menuPosition && (
              <div className="ios-ai-session-menu" role="menu" style={{ top: menuPosition.top, right: menuPosition.right }}>
                <button type="button" role="menuitem" onClick={() => beginRenameSession(menuSession)}>
                  <PencilSimpleIcon size={16} />
                  重命名
                </button>
                <button className="danger" type="button" role="menuitem" onClick={() => void deleteSession(menuSession.id)}>
                  <TrashIcon size={16} />
                  删除
                </button>
              </div>
            )}
            <button className="ios-ai-session-clear" type="button" onClick={() => void clearCurrentSession()} disabled={!activeSession}>
              <TrashIcon size={16} />
              清空当前会话内容
            </button>
          </aside>
        </div>
      )}
      {loading ? (
        <div className="ios-ai-loading">正在打开 AI 助手…</div>
      ) : activeSession ? (
        <AiChat
          bookId={book?.id}
          page="AI 助手"
          sessionId={activeSession.id}
          clearSignal={clearSignal}
          onSessionActivity={updateSessionActivity}
        />
      ) : (
        <div className="ios-ai-loading">暂无会话</div>
      )}
    </IosSheet>
  );
}

function truncateTitle(value: string) {
  const title = value.trim() || "新会话";
  return title.length > 14 ? `${title.slice(0, 14)}…` : title;
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
