export function useAuth() {
  const c = (window as unknown as { PO_FIXTURE: { user: string; anonymous: boolean } }).PO_FIXTURE;
  return {
    session: c.anonymous ? null : { user: { id: c.user }, access_token: "synthetic-local-only" },
    loading: false,
  };
}
