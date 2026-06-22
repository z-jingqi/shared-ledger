import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Button({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`ui-button ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Panel({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={`ui-panel ${className}`} {...props}>
      {children}
    </section>
  );
}
export function PageTitle({
  title,
  left,
  action,
}: {
  title: string;
  left?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div className="page-title-side">{left}</div>
      <h1>{title}</h1>
      <div className="page-title-side page-title-action">{action}</div>
    </header>
  );
}
