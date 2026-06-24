import { useSearchParams } from "react-router-dom";
import { useApi } from "./useApi";

type Book = { id: string; name: string };
export function useActiveBook() {
  const [search] = useSearchParams();
  const { data, ...state } = useApi<{ books: Book[] }>("/books");
  const requested = search.get("bookId");
  const books = data?.books ?? [];
  const book = books.find((item) => item.id === requested) ?? books[0];
  return { ...state, book, books };
}
