import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { clearLastActiveBookId, readLastActiveBookId, writeLastActiveBookId } from "./activeBookStorage";
import { useApi } from "./useApi";

type Book = { id: string; name: string; currency: string };
const emptyBooks: Book[] = [];

export function useActiveBook() {
  const [search, setSearch] = useSearchParams();
  const { user } = useAuth();
  const { data, ...state } = useApi<{ books: Book[] }>(user ? "/books" : undefined);
  const requested = search.get("bookId");
  const books = data?.books ?? emptyBooks;
  const stored = readLastActiveBookId(user?.id);
  const book =
    books.find((item) => item.id === requested) ?? books.find((item) => item.id === stored) ?? books[0];

  useEffect(() => {
    if (!book || !user) return;
    writeLastActiveBookId(book.id, user.id);
  }, [book, user]);

  useEffect(() => {
    if (!user) return;
    if (state.loading || state.error) return;
    const requestedMissing = requested && !books.some((item) => item.id === requested);
    if (!requestedMissing && (book || !stored)) return;
    if (!book) {
      clearLastActiveBookId(user.id);
      if (requested) {
        const next = new URLSearchParams(search);
        next.delete("bookId");
        setSearch(next, { replace: true });
      }
      return;
    }
    const next = new URLSearchParams(search);
    next.set("bookId", book.id);
    setSearch(next, { replace: true });
  }, [book, books, requested, search, setSearch, state.error, state.loading, stored, user]);

  const setActiveBook = (bookId: string) => {
    writeLastActiveBookId(bookId, user?.id);
    const next = new URLSearchParams(search);
    next.set("bookId", bookId);
    setSearch(next);
  };

  return { ...state, book, books, setActiveBook };
}
