import {
  ArrowSquareOutIcon,
  ChartLineIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  NavigationArrowIcon,
  PlusIcon,
  ReceiptIcon,
  UserPlusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button, Textarea } from "@shared-ledger/ui";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Streamdown } from "streamdown";
import type {
  AiAnalysisCardPart,
  AiConfirmationPart,
  AiImportJobCardPart,
  AiInviteCardPart,
  AiNavigationCardPart,
  AiRecordCardPart,
  AiSearchResultCardPart,
  AiToolStatusPart,
} from "../../features/ai/types";
import type { ImportAttachmentView } from "../imports/ImportAttachmentCards";
import { ImportAttachmentCards } from "../imports/ImportAttachmentCards";

export function AiConversation({ children }: { children: ReactNode }) {
  return (
    <div className="ai-messages" aria-live="polite">
      {children}
    </div>
  );
}

export function AiMessage({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return <article className={`ai-message ${role === "user" ? "ai-user" : "ai-assistant"}`}>{children}</article>;
}

export function AiMarkdownText({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const segments = useMemo(() => splitTextLinks(children), [children]);
  return (
    <div className="ai-part-stack">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          segment.text.trim() ? (
            <Streamdown
              key={`${segment.kind}_${index}`}
              className="ai-markdown"
              mode={streaming && index === segments.length - 1 ? "streaming" : "static"}
            >
              {segment.text}
            </Streamdown>
          ) : null
        ) : (
          <AiNavigationCard key={`${segment.kind}_${index}`} part={segment.part} />
        ),
      )}
    </div>
  );
}

export function AiPromptInput({
  attachments,
  attachmentError,
  busy,
  canAttach,
  accept,
  input,
  textareaRef,
  fileInputRef,
  isStreaming,
  onAddAttachments,
  onClearAttachment,
  onInputChange,
  onStop,
  onSubmit,
}: {
  attachments: ImportAttachmentView[];
  attachmentError?: string;
  busy: boolean;
  canAttach: boolean;
  accept: string;
  input: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isStreaming: boolean;
  onAddAttachments: (files: FileList | null) => void;
  onClearAttachment: (id: string) => void;
  onInputChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const expanded = input.trim().length > 0 || attachments.length > 0;
  return (
    <form className={`ai-composer ${expanded ? "expanded" : ""}`} onSubmit={onSubmit}>
      <ImportAttachmentCards attachments={attachments} onRemove={onClearAttachment} />
      {attachmentError && <p className="ai-composer-notice">{attachmentError}</p>}
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        accept={accept}
        onChange={(event) => onAddAttachments(event.currentTarget.files)}
      />
      <Button
        aria-label="添加附件"
        className="ai-composer-attach"
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy || !canAttach}
      >
        <PlusIcon />
      </Button>
      <Textarea
        ref={textareaRef}
        className="ai-composer-textarea"
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="输入消息..."
        disabled={busy}
        rows={1}
      />
      {isStreaming ? (
        <Button className="ai-composer-send" type="button" size="icon" aria-label="停止" onClick={onStop}>
          <XIcon />
        </Button>
      ) : (
        <Button className="ai-composer-send" aria-label="发送" size="icon" disabled={busy || (!input.trim() && attachments.length === 0)}>
          <NavigationArrowIcon weight="fill" />
        </Button>
      )}
    </form>
  );
}

export function AiPendingConfirmationBar({
  attachments,
  title = "保存这些附件？",
  description,
  confirmLabel = "保存",
  cancelLabel = "取消",
  expiresAt,
  progressDurationMs = 10_000,
  busy = false,
  onCancel,
  onConfirm,
}: {
  attachments?: ImportAttachmentView[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  expiresAt: number;
  progressDurationMs?: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const createdAt = useMemo(() => Math.max(Date.now(), expiresAt - progressDurationMs), [expiresAt, progressDurationMs]);
  const remaining = Math.max(0, expiresAt - now);
  const progress = Math.max(0, Math.min(1, remaining / Math.max(1, expiresAt - createdAt)));
  const attachmentNames = attachments?.map((attachment) => attachment.file.name).join("、");

  useEffect(() => {
    if (remaining <= 0) {
      onCancel();
      return undefined;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [onCancel, remaining]);

  return (
    <section className="ai-pending-confirmation" aria-label={attachments?.length ? "附件保存确认" : "AI 操作确认"}>
      <div className="ai-pending-copy">
        <strong>{title}</strong>
        {(description || attachmentNames) && <span>{description ?? attachmentNames}</span>}
      </div>
      <div className="ai-pending-actions">
        <Button type="button" size="sm" onClick={onConfirm} disabled={busy}>
          {busy ? `${confirmLabel}中` : confirmLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
      </div>
      <div className="ai-pending-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
    </section>
  );
}

export function AiToolStatus({ part }: { part: AiToolStatusPart }) {
  const failed = part.status === "failed";
  const complete = part.status === "success";
  return (
    <section className={`ai-structured-card ai-tool-status ${failed ? "failed" : complete ? "success" : ""}`}>
      {failed ? <WarningCircleIcon weight="fill" /> : complete ? <CheckCircleIcon weight="fill" /> : <CircleNotchIcon weight="bold" />}
      <div>
        <strong>{part.label ?? part.toolName ?? "正在处理"}</strong>
        {part.message && <p>{part.message}</p>}
      </div>
    </section>
  );
}

export function AiRecordCard({ part }: { part: AiRecordCardPart }) {
  return (
    <section className="ai-structured-card ai-record-card">
      <ReceiptIcon weight="fill" />
      <div>
        <strong>{part.title ?? "记录"}</strong>
        <p>{[part.categoryName, part.note, part.occurredAt].filter(Boolean).join(" · ")}</p>
      </div>
      {part.amount !== undefined && <b>{part.amount}</b>}
      {part.href && part.pageName && <AiNavigationCard part={{ type: "navigation-card", pageName: part.pageName, href: part.href }} compact />}
    </section>
  );
}

export function AiSearchResultCard({ part }: { part: AiSearchResultCardPart }) {
  return (
    <section className="ai-structured-card ai-list-card">
      <header>
        <MagnifyingGlassIcon weight="bold" />
        <div>
          <strong>{part.title ?? "搜索结果"}</strong>
          {part.summary && <p>{part.summary}</p>}
        </div>
      </header>
      {part.results?.length ? (
        <div className="ai-card-list">
          {part.results.map((result, index) => (
            <div className="ai-card-list-row" key={result.id ?? `${result.title}_${index}`}>
              <div>
                <strong>{result.title ?? "结果"}</strong>
                {result.description && <span>{result.description}</span>}
              </div>
              {result.amount !== undefined && <b>{result.amount}</b>}
              {result.href && result.pageName && (
                <AiNavigationCard part={{ type: "navigation-card", pageName: result.pageName, href: result.href }} compact />
              )}
            </div>
          ))}
        </div>
      ) : null}
      {part.href && part.pageName && <AiNavigationCard part={{ type: "navigation-card", pageName: part.pageName, href: part.href }} compact />}
    </section>
  );
}

export function AiAnalysisCard({ part }: { part: AiAnalysisCardPart }) {
  return (
    <section className="ai-structured-card ai-analysis-card">
      <header>
        <ChartLineIcon weight="bold" />
        <div>
          <strong>{part.title ?? "分析"}</strong>
          {part.summary && <p>{part.summary}</p>}
        </div>
      </header>
      {part.metrics?.length ? (
        <div className="ai-metric-grid">
          {part.metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.hint && <em>{metric.hint}</em>}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AiImportJobCard({ part }: { part: AiImportJobCardPart }) {
  return (
    <section className="ai-structured-card ai-list-card">
      <header>
        <FileTextIcon weight="bold" />
        <div>
          <strong>{part.title ?? "导入任务"}</strong>
          {part.message && <p>{part.message}</p>}
        </div>
      </header>
      {part.jobs?.length ? (
        <div className="ai-card-list">
          {part.jobs.map((job) => (
            <div className="ai-card-list-row" key={job.id}>
              <div>
                <strong>{job.fileName}</strong>
                <span>{job.stage ?? job.status}</span>
              </div>
              {typeof job.progress === "number" && <b>{job.progress}%</b>}
            </div>
          ))}
        </div>
      ) : null}
      {part.href && part.pageName && <AiNavigationCard part={{ type: "navigation-card", pageName: part.pageName, href: part.href }} compact />}
    </section>
  );
}

export function AiInviteCard({ part }: { part: AiInviteCardPart }) {
  return (
    <section className="ai-structured-card ai-invite-card">
      <UserPlusIcon weight="fill" />
      <div>
        <strong>{part.title ?? "成员邀请"}</strong>
        <p>{[part.email, part.role, part.status].filter(Boolean).join(" · ")}</p>
      </div>
      {part.href && part.pageName && <AiNavigationCard part={{ type: "navigation-card", pageName: part.pageName, href: part.href }} compact />}
    </section>
  );
}

export function AiNavigationCard({ part, compact = false }: { part: AiNavigationCardPart; compact?: boolean }) {
  const navigate = useNavigate();
  const target = part.href ?? part.to ?? part.path ?? part.url;
  const open = () => {
    if (!target) return;
    if (/^https?:\/\//.test(target)) {
      window.location.assign(target);
      return;
    }
    navigate(target);
  };
  return (
    <button
      className={`ai-navigation-card ${compact ? "compact" : ""}`}
      type="button"
      onClick={open}
      disabled={!target}
      aria-label={`打开${part.pageName}`}
    >
      <span>
        <strong>{part.pageName}</strong>
        {part.description && <small>{part.description}</small>}
      </span>
      <ArrowSquareOutIcon weight="bold" />
    </button>
  );
}

export function AiConfirmation({ part }: { part: AiConfirmationPart }) {
  return (
    <section className="ai-structured-card ai-confirmation-card">
      <div>
        <strong>{part.title ?? "需要确认"}</strong>
        {part.message && <p>{part.message}</p>}
      </div>
    </section>
  );
}

type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "navigation"; part: AiNavigationCardPart };

function splitTextLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s)]+)|(\/(?:records|analysis|members|settings|books|home)(?:[^\s)]*)?)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ kind: "text", text: text.slice(cursor, index) });
    const label = match[1];
    const target = match[2] ?? match[3] ?? match[4];
    segments.push({
      kind: "navigation",
      part: {
        type: "navigation-card",
        pageName: label || inferPageName(target),
        href: target,
      },
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments.length ? segments : [{ kind: "text", text }];
}

function inferPageName(target: string) {
  try {
    const url = new URL(target, window.location.origin);
    if (url.pathname.includes("/records/pending")) return "待确认记录";
    if (url.pathname.includes("/records/imports")) return "导入历史";
    if (url.pathname.includes("/records/new")) return "新增记录";
    if (url.pathname.includes("/records")) return "记录";
    if (url.pathname.includes("/analysis")) return "分析";
    if (url.pathname.includes("/members")) return "成员";
    if (url.pathname.includes("/settings")) return "设置";
    if (url.pathname.includes("/books")) return "账本";
    if (url.pathname.includes("/home")) return "首页";
  } catch {
    return "目标页面";
  }
  return "目标页面";
}
