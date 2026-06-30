import type { ButtonHTMLAttributes, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react";

export type IosBookLike = { id?: string; name?: string; currency?: string; color?: string };

export function BookMark({ book, size = 26 }: { book?: IosBookLike; size?: number }) {
  const color = bookColor(book);
  return (
    <span className="ios-book-mark" style={{ "--book-color": color, width: size, height: size } as CSSProperties}>
      {bookInitial(book)}
    </span>
  );
}

function LedgerPill({
  book,
  label,
  suffix,
  onClick,
  className = "",
}: {
  book?: IosBookLike;
  label?: string;
  suffix?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button className={`ios-ledger-pill ${className}`} type="button" onClick={onClick}>
      <BookMark book={book} />
      <span>{label ?? book?.name ?? "未选择账本"}</span>
      {suffix ? <em>{suffix}</em> : null}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function IosTopBar({
  book,
  title,
  suffix,
  onLedgerClick,
  action,
  back,
  onBack,
}: {
  book?: IosBookLike;
  title?: string;
  suffix?: ReactNode;
  onLedgerClick?: () => void;
  action?: ReactNode;
  back?: boolean;
  onBack?: () => void;
}) {
  return (
    <header className={`ios-topbar${back ? " with-back" : ""}`}>
      {back ? (
        <button className="ios-topbar-back" type="button" aria-label="返回" onClick={onBack}>
          <CaretLeftIcon size={23} weight="bold" />
        </button>
      ) : null}
      {title ? <h1>{title}</h1> : <LedgerPill book={book} suffix={suffix} onClick={onLedgerClick} />}
      {action ?? (back ? <span className="ios-topbar-spacer" aria-hidden="true" /> : null)}
    </header>
  );
}

export function AiSparkButton({ onClick, label = "打开 AI 助手" }: { onClick?: () => void; label?: string }) {
  return (
    <button className="ios-ai-spark" type="button" aria-label={label} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" fill="currentColor" />
        <circle cx="18.5" cy="5.5" r="1.5" fill="currentColor" opacity=".62" />
      </svg>
    </button>
  );
}

export function IosPage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ios-page ${className}`}>{children}</div>;
}

export function IosScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ios-scroll ${className}`}>{children}</div>;
}

export function IosCard({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  if (onClick)
    return (
      <button className={`ios-card ${className}`} type="button" onClick={onClick}>
        {children}
      </button>
    );
  return <section className={`ios-card ${className}`}>{children}</section>;
}

function IosSkeleton({ className = "" }: { className?: string }) {
  return <span className={`ios-skeleton ${className}`} aria-hidden="true" />;
}

export function IosListSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`ios-list-skeleton ${className}`} aria-label="加载中" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="ios-list-skeleton-row" key={index}>
          <IosSkeleton className="ios-list-skeleton-leading" />
          <span>
            <IosSkeleton className="ios-list-skeleton-title" />
            <IosSkeleton className="ios-list-skeleton-subtitle" />
          </span>
          <IosSkeleton className="ios-list-skeleton-amount" />
        </div>
      ))}
    </div>
  );
}

export function IosMetric({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: "neutral" | "income" | "accent" }) {
  return (
    <div className={`ios-metric ${tone}`}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

export function IconTile({
  children,
  tint,
  color,
  className = "",
}: {
  children: ReactNode;
  tint?: string;
  color?: string;
  className?: string;
}) {
  return (
    <span className={`ios-icon-tile ${className}`} style={{ background: tint, color } as CSSProperties}>
      {children}
    </span>
  );
}

export function IosSheet({
  title,
  children,
  footer,
  onClose,
  onBack,
  back,
  left,
  right,
  full = false,
  className = "",
  hideGrabber = false,
  disableDragClose = false,
  disableBackdropClose = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  back?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  full?: boolean;
  className?: string;
  hideGrabber?: boolean;
  disableDragClose?: boolean;
  disableBackdropClose?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const latestYRef = useRef(0);
  const currentDragYRef = useRef(0);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const closeAnimated = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(onClose, 190);
  }, [closing, onClose]);
  const applyDrag = useCallback((clientY: number) => {
    if (!draggingRef.current) return;
    const delta = clientY - startYRef.current;
    const next = Math.max(-28, latestYRef.current + delta);
    currentDragYRef.current = next;
    setDragY(next);
  }, []);
  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const threshold = Math.min(220, Math.max(120, window.innerHeight * 0.18));
    if (currentDragYRef.current > threshold) closeAnimated();
    else {
      currentDragYRef.current = 0;
      setDragY(0);
    }
  }, [closeAnimated]);
  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disableDragClose) return;
    startYRef.current = event.clientY;
    latestYRef.current = dragY;
    currentDragYRef.current = dragY;
    draggingRef.current = true;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [disableDragClose, dragY]);
  const moveDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    applyDrag(event.clientY);
  }, [applyDrag]);
  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishDrag();
  }, [finishDrag]);
  const handleWindowDragMove = useEffectEvent((event: globalThis.PointerEvent) => applyDrag(event.clientY));
  const handleWindowDragEnd = useEffectEvent(() => finishDrag());

  useEffect(() => {
    if (!dragging) return undefined;
    const handleMove = (event: globalThis.PointerEvent) => handleWindowDragMove(event);
    const handleEnd = () => handleWindowDragEnd();
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("blur", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("blur", handleEnd);
    };
  }, [dragging]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  return (
    <div className={`ios-overlay ${full ? "full" : ""}${closing ? " closing" : ""}`}>
      <button
        className="ios-overlay-backdrop"
        type="button"
        aria-label="弹层背景"
        onClick={disableBackdropClose ? undefined : closeAnimated}
      />
      <dialog
        open
        className={`ios-sheet ${full ? "full" : ""} ${className}${closing ? " closing" : ""}${dragging ? " dragging" : ""}`}
        aria-modal="true"
        aria-label={title}
        style={{
          transform: `translateY(${closing ? "110%" : `${dragY}px`})`,
          marginBottom: !closing && dragY < 0 ? `${dragY}px` : undefined,
        }}
      >
        <header className={`ios-sheet-header ${full ? "full" : ""}`}>
          {!hideGrabber && (
            <button
              className="ios-sheet-grabber"
              type="button"
              aria-label="拖动关闭"
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          )}
          {left ? (
            <span className="ios-sheet-back ios-sheet-left-action">{left}</span>
          ) : back ? (
            <button className="ios-sheet-back" type="button" onClick={onBack ?? closeAnimated} aria-label="返回">
              <CaretLeftIcon size={22} weight="bold" aria-hidden />
            </button>
          ) : (
            <span className="ios-sheet-back" aria-hidden="true" />
          )}
          <h2>{title}</h2>
          <div className={`ios-sheet-right${right ? " with-action" : ""}`}>
            {right ? <span className="ios-sheet-right-action">{right}</span> : null}
          </div>
        </header>
        <div className="ios-sheet-body ios-scroll">{children}</div>
        {footer ? <footer className="ios-sheet-footer">{footer}</footer> : null}
      </dialog>
    </div>
  );
}

export function IosButton({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "danger" }) {
  return (
    <button className={`ios-button ${variant} ${className}`} type="button" {...props}>
      {children}
    </button>
  );
}

export function IosField({
  label,
  children,
  icon,
  error,
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <label className="ios-field">
      <span>
        {icon}
        {label}
      </span>
      {children}
      {error ? <em>{error}</em> : null}
    </label>
  );
}

export function IosSegment<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`ios-segment ${className}`}>
      {options.map((option) => (
        <button className={option.value === value ? "selected" : ""} type="button" onClick={() => onChange(option.value)} key={option.value}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function IosDialog({
  title,
  message,
  confirmText = "确认",
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="ios-dialog-layer">
      <button className="ios-dialog-backdrop" type="button" aria-label="取消" onClick={onCancel} />
      <dialog open className="ios-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        {danger ? <span className="ios-dialog-danger">!</span> : null}
        <h2>{title}</h2>
        <p>{message}</p>
        <div>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className={danger ? "danger" : ""} type="button" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function bookInitial(book?: IosBookLike) {
  return (book?.name?.trim()?.[0] ?? "账").toUpperCase();
}

function bookColor(book?: IosBookLike) {
  const colors = ["#ff681c", "#4c8dff", "#14b8a6", "#a855f7", "#ff5d8f"];
  if (!book?.id) return book?.color ?? colors[0];
  const sum = Array.from(book.id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return book.color ?? colors[sum % colors.length];
}
