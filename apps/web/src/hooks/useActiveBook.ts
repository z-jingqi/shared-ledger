import { useSearchParams } from "react-router-dom";
import { useApi } from "./useApi";

type Book = { id: string; name: string };
export function useActiveBook() {
  const [search] = useSearchParams();
  const { data, ...state } = useApi<{ books: Book[] }>("/books");
  const requested = search.get("bookId");
  const book = data?.books.find((item) => item.id === requested) ?? data?.books[0];
  return { ...state, book };
}
