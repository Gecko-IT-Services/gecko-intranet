/* Every row of a Supabase query. The database hands out at most 1,000 rows per request, so a bigger table read in one go is
   silently cut short (19 Oct 2026: acronis_items had 3,400 rows; Coverage and the advice email lost clients' backup details).
   make: () => a fresh query builder, with a stable order. Pure: no window. */
export const PAGE = 1000;

export async function readAll(make, page = PAGE) {
  const out = [];
  for (let from = 0; from < 200 * page; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) throw new Error(error.message || 'Database request failed');
    out.push(...(data || []));
    if (!data || data.length < page) return out;
  }
  throw new Error('more than 200,000 rows: narrow the query');
}
