import { FileArrowUpIcon, NotePencilIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@shared-ledger/ui";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AiDrawer } from "../components/ai/AiDrawer";
import { mainNavigation } from "../features/ledger/data";
import { useAuth } from "../features/auth/AuthProvider";
import {
  isSupportedAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  supportedFileDescription,
} from "../features/imports/files";
import { uploadImportFiles } from "../features/imports/upload";
import { useActiveBook } from "../hooks/useActiveBook";

export function AppFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const isAuthPage = ["/login", "/register"].includes(location.pathname);
  const isCreateBookPage = location.pathname === "/books/new";
  const bottomNavTab = getBottomNavTab(location.pathname);
  const showBottomNav = bottomNavTab !== null;
  const showAiAssistant = user?.plan === "pro" && showBottomNav;
  const bottomNavigation = mainNavigation.filter((item) => item.label !== "添加");
  const AddIcon = mainNavigation[2].Icon;

  useEffect(() => {
    setAddMenuOpen(false);
  }, [location.pathname, location.search]);

  if (isAuthPage) return <main className="phone auth-shell">{children}</main>;

  const shellClassName = [
    "phone",
    isCreateBookPage ? "create-book-shell" : "",
    showBottomNav ? "has-bottom-nav" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName}>
      <div className="content">{children}</div>
      {showAiAssistant && (
        <>
          <Button
            className="ai-fab"
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开 AI 助手"
            onClick={() => setDrawerOpen(true)}
          >
            <RobotIcon size={25} weight="fill" />
          </Button>
          {drawerOpen && <AiDrawer close={() => setDrawerOpen(false)} />}
        </>
      )}
      {showBottomNav && (
        <nav className={`bottom-nav${addMenuOpen ? " open" : ""}`}>
          {bottomNavigation.slice(0, 2).map(({ to, label, Icon }) => {
            const active = bottomNavTab === navTabForLabel(label);
            return (
              <Link key={to} to={to} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                <Icon size={23} weight={active ? "fill" : "regular"} />
                <span>{label}</span>
              </Link>
            );
          })}
          <Button
            className={`bottom-add-button${addMenuOpen ? " open" : ""}`}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={addMenuOpen ? "关闭添加菜单" : "打开添加菜单"}
            aria-expanded={addMenuOpen}
            onClick={() => setAddMenuOpen((current) => !current)}
          >
            {addMenuOpen ? <XIcon size={26} weight="bold" /> : <AddIcon size={30} weight="bold" />}
          </Button>
          {bottomNavigation.slice(2).map(({ to, label, Icon }) => {
            const active = bottomNavTab === navTabForLabel(label);
            return (
              <Link key={to} to={to} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                <Icon size={23} weight={active ? "fill" : "regular"} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {showBottomNav && addMenuOpen && <AddActionSheet close={() => setAddMenuOpen(false)} />}
    </main>
  );
}

function AddActionSheet({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { book } = useActiveBook();
  const recordTarget = book ? `/records/new?bookId=${book.id}` : "/books/new";
  const uploadFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).slice(0, maxAttachmentFiles);
    if (!files.length) return;
    if (!book) {
      navigate("/books/new");
      close();
      return;
    }
    const unsupported = files.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      toast.error("附件格式暂不支持", {
        description: `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`,
      });
      return;
    }
    setUploading(true);
    try {
      await uploadImportFiles(book.id, files);
      toast.success("文件已上传", { description: "正在识别和分析，完成后会进入待确认记录。" });
      navigate("/records");
      close();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <>
      <button className="add-menu-backdrop" type="button" aria-label="关闭添加菜单" onClick={close} />
      <section className="add-action-sheet" role="dialog" aria-modal="true" aria-label="添加">
        <span className="sheet-grabber" aria-hidden="true" />
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          multiple
          accept={supportedFileAccept}
          onChange={(event) => void uploadFiles(event.currentTarget.files)}
        />
        <Link className="add-action-row" to={recordTarget} onClick={close}>
          <span className="add-action-icon manual">
            <NotePencilIcon size={24} weight="fill" />
          </span>
          <span>
            <b>手动记录</b>
            <small>{book ? "手动记一笔收支" : "先创建账本后记账"}</small>
          </span>
        </Link>
        <button
          className="add-action-row"
          type="button"
          disabled={uploading}
          onClick={() => {
            if (book) {
              fileInput.current?.click();
              return;
            }
            navigate("/books/new");
            close();
          }}
        >
          <span className="add-action-icon upload">
            <FileArrowUpIcon size={24} weight="fill" />
          </span>
          <span>
            <b>{uploading ? "上传中…" : "上传文件"}</b>
            <small>{book ? "上传票据、凭证，AI 自动识别" : "先创建账本后上传"}</small>
          </span>
        </button>
      </section>
    </>
  );
}

function navTabForLabel(label: string) {
  if (label === "首页") return "home";
  if (label === "记录") return "records";
  if (label === "分析") return "analysis";
  if (label === "我的") return "settings";
  return null;
}

function getBottomNavTab(pathname: string): "home" | "records" | "analysis" | "settings" | null {
  if (pathname === "/home") return "home";
  if (pathname === "/records") return "records";
  if (pathname === "/analysis") return "analysis";
  if (pathname === "/settings") return "settings";
  return null;
}
