import { ListIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { AiChat } from "../components/ai/AiChat";
import { AiSessionDirectory, type AiSession } from "../components/ai/AiSessionDirectory";
import { IosSheet } from "../components/ios/IosDesign";
import { useActiveBook } from "../hooks/useActiveBook";
import { api } from "../lib";

type AiSheetState = {
  activeSessionId?: string;
  loading: boolean;
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
  | { type: "delete-session"; sessionId: string };

const initialAiSheetState: AiSheetState = {
  activeSessionId: undefined,
  loading: true,
  sessions: [],
  showSessions: false,
};

function aiSheetReducer(state: AiSheetState, action: AiSheetAction): AiSheetState {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true };
    case "load-success":
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: state.activeSessionId ?? action.sessions[0]?.id,
        loading: false,
      };
    case "load-failure":
      return { ...state, loading: false };
    case "session-created":
      return {
        ...state,
        activeSessionId: action.session.id,
        sessions: [
          action.session,
          ...state.sessions.filter((session) => session.id !== action.session.id),
        ].slice(0, 20),
        showSessions: false,
      };
    case "session-activity":
      if (!action.title) return state;
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === state.activeSessionId
            ? {
                ...session,
                title: action.title || (action.hasMessages ? session.title : "新会话"),
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      };
    case "select-session":
      return { ...state, activeSessionId: action.sessionId, showSessions: false };
    case "show-sessions":
      return { ...state, showSessions: true };
    case "close-session-sheet":
      return { ...state, showSessions: false };
    case "delete-session": {
      const sessions = state.sessions.filter((session) => session.id !== action.sessionId);
      return {
        ...state,
        activeSessionId: state.activeSessionId === action.sessionId ? sessions[0]?.id : state.activeSessionId,
        sessions,
      };
    }
  }
}

export function AiPage() {
  const { book } = useActiveBook();
  return <Navigate to={book ? `/home?bookId=${book.id}` : "/home"} replace />;
}

export function AiSheet({ onClose }: { onClose: () => void }) {
  const { book } = useActiveBook();
  const [state, dispatch] = useReducer(aiSheetReducer, initialAiSheetState);
  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0],
    [state.activeSessionId, state.sessions],
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
        toast.error(cause instanceof Error ? cause.message : "读取 AI 会话失败", {
          duration: 3000,
          closeButton: true,
        });
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
      toast.error(cause instanceof Error ? cause.message : "创建会话失败", {
        duration: 3000,
        closeButton: true,
      });
    }
  };

  const updateSessionActivity = useCallback((detail: { title?: string; hasMessages?: boolean }) => {
    dispatch({ type: "session-activity", title: detail.title, hasMessages: detail.hasMessages });
  }, []);

  const deleteSession = async (sessionId: string) => {
    try {
      await api(`/ai/sessions/${sessionId}`, { method: "DELETE" });
      dispatch({ type: "delete-session", sessionId });
      toast.success("会话已删除", { duration: 2200, closeButton: true });
      if (state.sessions.length <= 1) await startNewSession();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除会话失败", {
        duration: 3000,
        closeButton: true,
      });
    }
  };

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
        <button
          className="ios-ai-session-trigger"
          type="button"
          aria-label="切换 AI 会话"
          onClick={() => dispatch({ type: "show-sessions" })}
        >
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
          onClose={() => dispatch({ type: "close-session-sheet" })}
          onDelete={(sessionId) => void deleteSession(sessionId)}
          onNewSession={() => void startNewSession()}
          onSelectSession={(sessionId) => dispatch({ type: "select-session", sessionId })}
          sessions={state.sessions}
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
