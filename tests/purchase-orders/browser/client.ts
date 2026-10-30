const config = () => (window as unknown as { PO_FIXTURE: { user: string } }).PO_FIXTURE;
async function call(path: string, body: unknown) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-synthetic-actor": config().user },
    body: JSON.stringify(body),
  });
  return r.json();
}
export const supabase = {
  rpc: (name: string, args: Record<string, unknown>) => call("/fixture/rpc", { name, args }),
  from: (table: string) => ({
    select: () => ({
      eq: (_key: string, id: string) => ({ single: () => call("/fixture/context", { table, id }) }),
    }),
  }),
};
