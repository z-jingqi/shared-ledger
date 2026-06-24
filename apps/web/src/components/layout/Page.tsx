import { CaretLeftIcon } from "@phosphor-icons/react";
import { Button, PageTitle } from "@shared-ledger/ui";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function BackButton({ to }: { to?: string }) {
  const navigate = useNavigate();
  return (
    <Button
      className="back"
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      aria-label="返回"
    >
      <CaretLeftIcon size={30} />
    </Button>
  );
}

export function Page({
  title,
  children,
  action,
  back = true,
  backTo,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  back?: boolean;
  backTo?: string;
}) {
  return (
    <>
      <PageTitle title={title} left={back ? <BackButton to={backTo} /> : undefined} action={action} />
      {children}
    </>
  );
}
