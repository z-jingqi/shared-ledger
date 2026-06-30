import { CaretRightIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import { BookMark, IosListSkeleton, IosPage, IosScroll, IosTopBar } from "../components/ios/IosDesign";
import { useActiveBook } from "../hooks/useActiveBook";

export function BooksPage() {
  const { book, books, loading, error } = useActiveBook();
  const navigate = useNavigate();
  return (
    <IosPage>
      <IosTopBar title="管理账本" back onBack={() => navigate("/settings")} />
      <IosScroll className="ios-book-list-screen">
        {loading && <IosListSkeleton rows={3} />}
        {error && <p className="field-error">{error}</p>}
        {!loading && !error && books.length === 0 && (
          <div className="ios-empty">
            <b>当前还没有账本</b>
            <Link className="ios-link-button" to="/books/new?source=manage">创建一个</Link>
          </div>
        )}
        {books.map((item) => {
          const active = item.id === book?.id;
          return (
            <button
              className={`ios-book-list-row${active ? " active" : ""}`}
              type="button"
              onClick={() => navigate(`/books/${item.id}/settings`, { replace: false })}
              key={item.id}
            >
              <BookMark book={item} size={44} />
              <span>
                <b>{item.name}</b>
                <small>{item.currency} · {active ? "当前账本 · 点击管理" : "点击管理"}</small>
              </span>
              <CaretRightIcon size={18} />
            </button>
          );
        })}
        <Link className="ios-create-book-row ios-button primary" to="/books/new?source=manage">
          <b>创建新账本</b>
        </Link>
      </IosScroll>
    </IosPage>
  );
}
