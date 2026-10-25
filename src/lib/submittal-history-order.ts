/** Display order of immutable package copies; never renumber an issued transmittal or PDF. */
export function submittalHistoryOrder(packages: { id: string; created_at: string }[]) {
  const sorted = [...packages].sort((a, b) => {
    const x = Date.parse(a.created_at),
      y = Date.parse(b.created_at);
    return (
      (Number.isFinite(x) && Number.isFinite(y)
        ? x - y
        : a.created_at.localeCompare(b.created_at)) || a.id.localeCompare(b.id)
    );
  });
  return new Map(sorted.map((p, index) => [p.id, `Build ${index + 1} of ${sorted.length}`]));
}
