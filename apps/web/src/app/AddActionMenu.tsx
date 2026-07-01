import { FileArrowUpIcon, PencilSimpleLineIcon, PlusIcon } from "@phosphor-icons/react";
import { IconTile } from "../components/ios/IosDesign";

type AddActionMenuProps = {
  open: boolean;
  showUpload: boolean;
  uploading: boolean;
  onManualAdd: () => void;
  onOpenChange: (open: boolean) => void;
  onUploadFile: () => void;
};

export function AddActionMenu({ open, showUpload, uploading, onManualAdd, onOpenChange, onUploadFile }: AddActionMenuProps) {
  return (
    <>
      {open ? (
        <button
          className="ios-add-menu-backdrop"
          type="button"
          aria-label="关闭添加菜单"
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      {open ? (
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
        className={`ios-fab${open ? " open" : ""}`}
        type="button"
        aria-label={open ? "关闭添加菜单" : "打开添加菜单"}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <PlusIcon size={26} weight="bold" />
      </button>
    </>
  );
}
