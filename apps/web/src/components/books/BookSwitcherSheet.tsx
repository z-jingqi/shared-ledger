import { Link } from "react-router-dom";
import { BookMark, IosSheet } from "../ios/IosDesign";

export type BookSwitcherBook = {
  id: string;
  name: string;
  currency: string;
  color?: string;
};

export function BookSwitcherSheet({
  books,
  currentBookId,
  onSelect,
  close,
}: {
  books: BookSwitcherBook[];
  currentBookId: string;
  onSelect: (bookId: string) => void;
  close: () => void;
}) {
  return (
    <IosSheet title="切换账本" onClose={close}>
      <div className="ios-book-switcher-list">
        {books.map((item) => (
          <button className={item.id === currentBookId ? "active" : ""} type="button" onClick={() => onSelect(item.id)} key={item.id}>
            <BookMark book={item} size={44} />
            <span>
              <b>{item.name}</b>
              <small>{item.currency} · {item.id === currentBookId ? "当前" : "点击切换"}</small>
            </span>
            <b>{item.id === currentBookId ? "当前" : ""}</b>
          </button>
        ))}
        <Link to="/books/new" onClick={close}>
          <span>+</span>
          创建新账本
        </Link>
      </div>
    </IosSheet>
  );
}
