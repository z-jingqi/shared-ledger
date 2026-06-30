import {
  CheckIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { KeyboardEvent, MouseEvent, RefObject } from "react";

export type AiSession = {
  id: string;
  title: string;
  bookId?: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionMenuPosition = {
  top: number;
  right: number;
};

export function AiSessionDirectory({
  activeSessionId,
  menuPosition,
  menuSession,
  menuSessionId,
  onBeginRename,
  onClearCurrent,
  onClose,
  onDelete,
  onNewSession,
  onRenameKeyDown,
  onRenameValueChange,
  onSaveRename,
  onScroll,
  onSearchChange,
  onSelectSession,
  onToggleMenu,
  renameValue,
  renamingSessionId,
  searchValue,
  sheetRef,
  visibleSessions,
}: {
  activeSessionId?: string;
  menuPosition?: SessionMenuPosition;
  menuSession?: AiSession;
  menuSessionId?: string;
  onBeginRename: (session: AiSession) => void;
  onClearCurrent: () => void;
  onClose: () => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRenameValueChange: (value: string) => void;
  onSaveRename: () => void;
  onScroll: () => void;
  onSearchChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  onToggleMenu: (sessionId: string, event: MouseEvent<HTMLButtonElement>) => void;
  renameValue: string;
  renamingSessionId?: string;
  searchValue: string;
  sheetRef: RefObject<HTMLElement | null>;
  visibleSessions: AiSession[];
}) {
  return (
    <div className="ios-ai-session-sheet-layer open">
      <button className="ios-ai-session-sheet-backdrop" type="button" aria-label="关闭会话目录" onClick={onClose} />
      <aside className="ios-ai-session-sheet" aria-label="AI 会话目录" ref={sheetRef}>
        <header>
          <span>
            <b>会话</b>
            <small>切换、重命名或删除</small>
          </span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <XIcon size={18} weight="bold" />
          </button>
        </header>
        <button className="ios-ai-session-new" type="button" onClick={onNewSession}>
          <PlusIcon size={17} weight="bold" />
          新会话
        </button>
        <label className="ios-ai-session-search">
          <MagnifyingGlassIcon size={16} weight="bold" />
          <input aria-label="搜索会话" value={searchValue} onChange={(event) => onSearchChange(event.currentTarget.value)} placeholder="搜索会话" />
        </label>
        <menu className="ios-ai-session-sheet-list" onScroll={onScroll}>
          {visibleSessions.length ? (
            visibleSessions.map((session) => (
              <li className={`ios-ai-session-row${session.id === activeSessionId ? " active" : ""}`} key={session.id}>
                {renamingSessionId === session.id ? (
                  <label>
                    <input
                      aria-label="会话名称"
                      value={renameValue}
                      onChange={(event) => onRenameValueChange(event.currentTarget.value)}
                      onKeyDown={onRenameKeyDown}
                    />
                  </label>
                ) : (
                  <button className="ios-ai-session-select" type="button" onClick={() => onSelectSession(session.id)}>
                    <b>{session.title || "新会话"}</b>
                    <small>{formatSessionTime(session.updatedAt)}</small>
                  </button>
                )}
                {renamingSessionId === session.id ? (
                  <button className="ios-ai-session-row-icon" type="button" aria-label="保存名称" onClick={onSaveRename}>
                    <CheckIcon size={17} weight="bold" />
                  </button>
                ) : (
                  <button
                    className="ios-ai-session-row-icon"
                    type="button"
                    aria-label="会话更多操作"
                    aria-expanded={menuSessionId === session.id}
                    data-ai-session-menu-trigger="true"
                    onClick={(event) => onToggleMenu(session.id, event)}
                  >
                    <DotsThreeIcon size={20} weight="bold" />
                  </button>
                )}
              </li>
            ))
          ) : (
            <p className="ios-ai-session-empty">没有找到相关会话</p>
          )}
        </menu>
        {menuSession && menuPosition && (
          <div className="ios-ai-session-menu" role="menu" style={{ top: menuPosition.top, right: menuPosition.right }}>
            <button type="button" role="menuitem" onClick={() => onBeginRename(menuSession)}>
              <PencilSimpleIcon size={16} />
              重命名
            </button>
            <button className="danger" type="button" role="menuitem" onClick={() => onDelete(menuSession.id)}>
              <TrashIcon size={16} />
              删除
            </button>
          </div>
        )}
        <button className="ios-ai-session-clear" type="button" onClick={onClearCurrent} disabled={!activeSessionId}>
          <TrashIcon size={16} />
          清空当前会话内容
        </button>
      </aside>
    </div>
  );
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
