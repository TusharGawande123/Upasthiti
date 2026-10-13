// The shape of every paged list from the API: { items, page, page_size, total }.
export type Page<ItemType> = {
  items: ItemType[];
  page: number;
  page_size: number;
  total: number;
};

/** Builds "?a=1&b=2" from the filters that have a value. */
export function queryString(filters: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
