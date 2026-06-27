import type { ButtonHTMLAttributes, CSSProperties, FormEvent, ReactNode } from "react";
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

export function LedgerPill({
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
  back,
  right,
  full = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  back?: boolean;
  right?: ReactNode;
  full?: boolean;
  className?: string;
}) {
  return (
    <div className={`ios-overlay ${full ? "full" : ""}`}>
      <button className="ios-overlay-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <section className={`ios-sheet ${full ? "full" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className={`ios-sheet-header ${full ? "full" : ""}`}>
          {!full && <span className="ios-sheet-grabber" aria-hidden="true" />}
          <button className="ios-sheet-back" type="button" onClick={back ? onClose : undefined} aria-label={back ? "返回" : undefined}>
            {back ? "‹ 返回" : ""}
          </button>
          <h2>{title}</h2>
          <div className="ios-sheet-right">{right}</div>
        </header>
        <div className="ios-sheet-body ios-scroll">{children}</div>
        {footer ? <footer className="ios-sheet-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function FullScreenPanel({
  children,
  onClose,
  title,
  subtitle,
  icon,
  className = "",
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ios-fullscreen ${className}`}>
      <header className="ios-fullscreen-header">
        <button type="button" aria-label="返回" onClick={onClose}>
          <CaretLeftIcon size={24} weight="bold" />
        </button>
        {icon ? <span className="ios-fullscreen-icon">{icon}</span> : null}
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      {children}
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
      <section className="ios-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
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
      </section>
    </div>
  );
}

export function submitGuard(handler: () => Promise<void> | void) {
  return (event: FormEvent) => {
    event.preventDefault();
    void handler();
  };
}

export function bookInitial(book?: IosBookLike) {
  return (book?.name?.trim()?.[0] ?? "账").toUpperCase();
}

export function bookColor(book?: IosBookLike) {
  const colors = ["#ff681c", "#4c8dff", "#14b8a6", "#a855f7", "#ff5d8f"];
  if (!book?.id) return book?.color ?? colors[0];
  const sum = Array.from(book.id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return book.color ?? colors[sum % colors.length];
}

export function yuan(value: number | undefined | null, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}
