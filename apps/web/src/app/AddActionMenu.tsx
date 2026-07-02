import { FileArrowUpIcon, PencilSimpleLineIcon, PlusIcon } from "@phosphor-icons/react";
import { IconTile } from "../components/ios/IosDesign";

type AddActionMenuProps = {
  directManual?: boolean;
  open: boolean;
  showUpload: boolean;
  uploading: boolean;
  onManualAdd: () => void;
  onOpenChange: (open: boolean) => void;
  onUploadFile: () => void;
};

export function AddActionMenu({
  directManual = false,
  open,
  showUpload,
  uploading,
  onManualAdd,
  onOpenChange,
  onUploadFile,
}: AddActionMenuProps) {
  const menuOpen = !directManual && open;
  return (
    <>
      {menuOpen ? (
        <button
          className="ios-add-menu-backdrop"
          type="button"
          aria-label="关闭添加菜单"
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      {menuOpen ? (
        <div className="ios-add-menu" role="menu" aria-label="记账方式">
          <button type="button" role="menuitem" onClick={onManualAdd}>
            <IconTile tint="#fff0e8" color="#ff681c">
              <PencilSimpleLineIcon size={20} weight="bold" />
            </IconTile>
            <span>
              <b>手动添加</b>
              <small>进入记一笔表单</small>
            </span>
          </button>
          {showUpload ? (
            <button type="button" role="menuitem" disabled={uploading} onClick={onUploadFile}>
              <IconTile tint="#eaf1ff" color="#4c8dff">
                <FileArrowUpIcon size={20} weight="bold" />
              </IconTile>
              <span>
                <b>{uploading ? "上传中…" : "上传图片"}</b>
                <small>图片识别 · Pro 可用</small>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        className={`ios-fab${menuOpen ? " open" : ""}`}
        type="button"
        aria-label={directManual ? "记一笔" : menuOpen ? "关闭添加菜单" : "打开添加菜单"}
        aria-expanded={directManual ? undefined : menuOpen}
        onClick={directManual ? onManualAdd : () => onOpenChange(!menuOpen)}
      >
        <PlusIcon size={26} weight="bold" />
      </button>
    </>
  );
}
