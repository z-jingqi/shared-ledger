import { ListIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { AiChat } from "../components/ai/AiChat";
import { AiSessionDirectory, type AiSession, type SessionMenuPosition } from "../components/ai/AiSessionDirectory";
import { IosSheet } from "../components/ios/IosDesign";
import { useActiveBook } from "../hooks/useActiveBook";
import { api } from "../lib";

type AiSheetState = {
  activeSessionId?: string;
  loading: boolean;
  menuPosition?: SessionMenuPosition;
  menuSessionId?: string;
  renameValue: string;
  renamingSessionId?: string;
  sessionQuery: string;
  sessions: AiSession[];
  showSessions: boolean;
};
type AiSheetAction =
  | { type: "load-start" }
  | { type: "load-success"; sessions: AiSession[] }
  | { type: "load-failure" }
  | { type: "session-created"; session: AiSession }
  | { type: "session-activity"; title?: string; hasMessages?: boolean }
  | { type: "select-session"; sessionId: string }
  | { type: "show-sessions" }
  | { type: "close-session-sheet" }
  | { type: "close-menu" }
  | { type: "open-menu"; sessionId: string; position: SessionMenuPosition }
  | { type: "begin-rename"; session: AiSession }
  | { type: "rename-value"; value: string }
  | { type: "rename-cancel" }
  | { type: "rename-saved"; session: AiSession }
  | { type: "delete-session"; sessionId: string }
  | { type: "search"; value: string };

const initialAiSheetState: AiSheetState = {
  activeSessionId: undefined,
  loading: true,
  menuPosition: undefined,
  menuSessionId: undefined,
  renameValue: "",
  renamingSessionId: undefined,
  sessionQuery: "",
  sessions: [],
  showSessions: false,
};

function aiSheetReducer(state: AiSheetState, action: AiSheetAction): AiSheetState {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true };
    case "load-success":
      return { ...state, sessions: action.sessions, activeSessionId: state.activeSessionId ?? action.sessions[0]?.id, loading: false };
    case "load-failure":
      return { ...state, loading: false };
    case "session-created":
      return {
        ...state,
        activeSessionId: action.session.id,
        menuPosition: undefined,
        menuSessionId: undefined,
        sessions: [action.session, ...state.sessions.filter((session) => session.id !== action.session.id)].slice(0, 20),
        showSessions: false,
      };
    case "session-activity":
      if (!action.title) return state;
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === state.activeSessionId
            ? { ...session, title: action.title || (action.hasMessages ? session.title : "新会话"), updatedAt: new Date().toISOString() }
            : session,
        ),
      };
    case "select-session":
      return { ...state, activeSessionId: action.sessionId, menuPosition: undefined, menuSessionId: undefined, showSessions: false };
    case "show-sessions":
      return { ...state, showSessions: true };
    case "close-session-sheet":
      return { ...state, menuPosition: undefined, menuSessionId: undefined, showSessions: false };
    case "close-menu":
      return { ...state, menuPosition: undefined, menuSessionId: undefined };
    case "open-menu":
      return { ...state, menuPosition: action.position, menuSessionId: action.sessionId };
    case "begin-rename":
      return { ...state, menuPosition: undefined, menuSessionId: undefined, renamingSessionId: action.session.id, renameValue: action.session.title };
    case "rename-value":
      return { ...state, renameValue: action.value };
    case "rename-cancel":
      return { ...state, renamingSessionId: undefined, renameValue: "" };
    case "rename-saved":
      return {
        ...state,
        renameValue: "",
        renamingSessionId: undefined,
        sessions: state.sessions.map((session) => (session.id === action.session.id ? action.session : session)),
      };
    case "delete-session": {
      const sessions = state.sessions.filter((session) => session.id !== action.sessionId);
      return {
        ...state,
        activeSessionId: state.activeSessionId === action.sessionId ? sessions[0]?.id : state.activeSessionId,
        menuPosition: undefined,
        menuSessionId: undefined,
        renamingSessionId: undefined,
        sessions,
      };
    }
    case "search":
      return { ...state, sessionQuery: action.value };
  }
}

export function AiPage() {
  const { book } = useActiveBook();
  return <Navigate to={book ? `/home?bookId=${book.id}` : "/home"} replace />;
}

export function AiSheet({ onClose }: { onClose: () => void }) {
  const { book } = useActiveBook();
  const sessionSheetRef = useRef<HTMLElement | null>(null);
  const [state, dispatch] = useReducer(aiSheetReducer, initialAiSheetState);
  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0],
    [state.activeSessionId, state.sessions],
  );
  const visibleSessions = useMemo(() => {
    const query = state.sessionQuery.trim().toLowerCase();
    if (!query) return state.sessions;
    return state.sessions.filter((session) => session.title.toLowerCase().includes(query));
  }, [state.sessionQuery, state.sessions]);
  const menuSession = useMemo(
    () => state.sessions.find((session) => session.id === state.menuSessionId),
    [state.menuSessionId, state.sessions],
  );

  useEffect(() => {
    let alive = true;
    dispatch({ type: "load-start" });
    const load = async () => {
      try {
        if (!alive) return;
        const result = await api<{ sessions: AiSession[] }>("/ai/sessions");
        if (alive && result.sessions.length) {
          dispatch({ type: "load-success", sessions: result.sessions });
        } else if (alive) {
          const created = await api<{ session: AiSession }>("/ai/sessions", {
            method: "POST",
            body: JSON.stringify({ bookId: book?.id, title: "新会话" }),
          });
          if (alive) dispatch({ type: "load-success", sessions: [created.session] });
        }
      } catch (cause) {
        if (!alive) return;
        dispatch({ type: "load-failure" });
        toast.error(cause instanceof Error ? cause.message : "读取 AI 会话失败", { duration: 3000, closeButton: true });
      }
    };
    void load();
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
      dispatch({ type: "session-created", session: result.session });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "创建会话失败", { duration: 3000, closeButton: true });
    }
  };

  const clearCurrentSession = async () => {
    if (!activeSession) return;
    await deleteSession(activeSession.id, true);
    await startNewSession();
  };

  const updateSessionActivity = useCallback((detail: { title?: string; hasMessages?: boolean }) => {
    dispatch({ type: "session-activity", title: detail.title, hasMessages: detail.hasMessages });
  }, []);

  const saveRenameSession = async () => {
    const title = state.renameValue.trim();
    if (!state.renamingSessionId || !title) return;
    try {
      const result = await api<{ session: AiSession }>(`/ai/sessions/${state.renamingSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.slice(0, 40) }),
      });
      dispatch({ type: "rename-saved", session: result.session });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "重命名失败", { duration: 3000, closeButton: true });
    }
  };

  const deleteSession = async (sessionId: string, silent = false) => {
    try {
      await api(`/ai/sessions/${sessionId}`, { method: "DELETE" });
      dispatch({ type: "delete-session", sessionId });
      if (!silent) toast.success("会话已删除", { duration: 2200, closeButton: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除会话失败", { duration: 3000, closeButton: true });
    }
  };

  const toggleSessionMenu = (sessionId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (state.menuSessionId === sessionId) {
      dispatch({ type: "close-menu" });
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
      dispatch({
        type: "open-menu",
        sessionId,
        position: {
        top,
        right: Math.max(sheetRect.right - buttonRect.right + 2, 16),
        },
      });
    } else {
      dispatch({ type: "open-menu", sessionId, position: { top: 120, right: 18 } });
    }
  };

  useEffect(() => {
    if (!state.menuSessionId) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".ios-ai-session-menu")) return;
      if (target.closest("[data-ai-session-menu-trigger='true']")) return;
      dispatch({ type: "close-menu" });
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "close-menu" });
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [state.menuSessionId]);

  const sheetTitle = truncateTitle(activeSession?.title || "新会话");
  const saveRenameOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void saveRenameSession();
    if (event.key === "Escape") dispatch({ type: "rename-cancel" });
  };

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
        <button className="ios-ai-session-trigger" type="button" aria-label="切换 AI 会话" onClick={() => dispatch({ type: "show-sessions" })}>
          <ListIcon size={20} weight="bold" />
        </button>
      }
      right={
        <button className="ios-ai-close-button" type="button" aria-label="关闭 AI 助手" onClick={onClose}>
          <XIcon size={20} weight="bold" />
        </button>
      }
    >
      {state.showSessions && (
        <AiSessionDirectory
          activeSessionId={activeSession?.id}
          menuPosition={state.menuPosition}
          menuSession={menuSession}
          menuSessionId={state.menuSessionId}
          onBeginRename={(session) => dispatch({ type: "begin-rename", session })}
          onClearCurrent={() => void clearCurrentSession()}
          onClose={() => dispatch({ type: "close-session-sheet" })}
          onDelete={(sessionId) => void deleteSession(sessionId)}
          onNewSession={() => void startNewSession()}
          onRenameKeyDown={saveRenameOnEnter}
          onRenameValueChange={(value) => dispatch({ type: "rename-value", value })}
          onSaveRename={() => void saveRenameSession()}
          onScroll={() => dispatch({ type: "close-menu" })}
          onSearchChange={(value) => dispatch({ type: "search", value })}
          onSelectSession={(sessionId) => dispatch({ type: "select-session", sessionId })}
          onToggleMenu={toggleSessionMenu}
          renameValue={state.renameValue}
          renamingSessionId={state.renamingSessionId}
          searchValue={state.sessionQuery}
          sheetRef={sessionSheetRef}
          visibleSessions={visibleSessions}
        />
      )}
      {state.loading ? (
        <div className="ios-ai-loading">正在打开 AI 助手…</div>
      ) : activeSession ? (
        <AiChat
          key={activeSession.id}
          bookId={book?.id}
          page="AI 助手"
          sessionId={activeSession.id}
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
