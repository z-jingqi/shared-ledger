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
export function PageTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      {action}
    </header>
  );
}
