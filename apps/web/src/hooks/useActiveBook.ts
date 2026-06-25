import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "./useApi";

export const LAST_ACTIVE_BOOK_STORAGE_KEY = "shared-ledger:last-active-book-id";

type Book = { id: string; name: string; currency: string };
export function useActiveBook() {
  const [search, setSearch] = useSearchParams();
  const { data, ...state } = useApi<{ books: Book[] }>("/books");
  const requested = search.get("bookId");
  const books = data?.books ?? [];
  const stored = useMemo(() => readLastActiveBookId(), []);
  const book =
    books.find((item) => item.id === requested) ??
    books.find((item) => item.id === stored) ??
    books[0];

  useEffect(() => {
    if (!book) return;
    writeLastActiveBookId(book.id);
  }, [book]);

  const setActiveBook = (bookId: string) => {
    writeLastActiveBookId(bookId);
    const next = new URLSearchParams(search);
    next.set("bookId", bookId);
    setSearch(next);
  };

  return { ...state, book, books, setActiveBook };
}

export function readLastActiveBookId() {
  try {
    return window.localStorage.getItem(LAST_ACTIVE_BOOK_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastActiveBookId(bookId: string) {
  try {
    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, bookId);
  } catch {
    // localStorage may be unavailable in private browsing or SSR-like tests.
  }
}
