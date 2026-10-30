// Server-only service. No send or write capability is exposed by this dashboard.
export async function requireSupportAdmin(client: any, userId: string) {
  const { data, error } = await client.from("user_roles").select("role").eq("user_id", userId);
  if (error || !(data ?? []).some((r: any) => r.role === "admin")) throw new Error("Forbidden");
}
export function safeAttachment(payload: any, index: number) {
  const a = payload?.attachments?.[index];
  if (
    !a ||
    typeof a.content !== "string" ||
    a.content.length > 12 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(a.content)
  )
    throw new Error("Attachment unavailable");
  return { content: a.content, filename: `support-attachment-${index + 1}.untrusted.bin` };
}
export async function supportDashboard(
  client: any,
  userId: string,
  ticketId: string | undefined,
  page: number,
) {
  await requireSupportAdmin(client, userId);
  if (!ticketId) {
    const { data, error } = await client
      .from("support_tickets")
      .select("id,ticket_number,brand,from_email,subject,status,received_at")
      .order("received_at", { ascending: false })
      .order("id")
      .range(page * 50, page * 50 + 49);
    if (error) throw new Error("Support tickets unavailable");
    return {
      tickets: await Promise.all(
        (data ?? []).map(async (t: any) => {
          const latest = await client
            .from("support_messages")
            .select("received_at")
            .eq("ticket_id", t.id)
            .order("received_at", { ascending: false })
            .limit(1);
          if (latest.error) throw new Error("Support conversation migration is required");
          return { ...t, last_update: latest.data?.[0]?.received_at ?? t.received_at };
        }),
      ),
    };
  }
  const ticket = await client
    .from("support_tickets")
    .select("id,ticket_number,brand,from_email,subject,status,received_at,raw_summary")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticket.error || !ticket.data) throw new Error("Ticket unavailable");
  const messages = await client
    .from("support_messages")
    .select(
      "id,received_at,evidence,review_reason,suppressed_reason,legacy_import,preview,ack_sent_at,owner_sent_at",
    )
    .eq("ticket_id", ticketId)
    .order("received_at")
    .order("id")
    .range(page * 50, page * 50 + 49);
  if (messages.error) throw new Error("Support conversations unavailable");
  return {
    ticket: ticket.data,
    messages: await Promise.all(
      (messages.data ?? []).map(async (m: any) => {
        const d = await client
          .from("support_deliveries")
          .select("kind,state,text:payload->>text")
          .eq("message_id", m.id);
        if (d.error) throw new Error("Delivery evidence unavailable");
        return {
          ...m,
          deliveries: (d.data ?? []).map((v: any) => ({
            kind: v.kind,
            state: v.state,
            text: typeof v.text === "string" ? v.text : "",
          })),
        };
      }),
    ),
  };
}
export async function supportAttachment(
  client: any,
  userId: string,
  messageId: string,
  index: number,
) {
  await requireSupportAdmin(client, userId);
  const { data, error } = await client
    .from("support_deliveries")
    .select("payload")
    .eq("message_id", messageId)
    .eq("kind", "owner")
    .maybeSingle();
  if (error || !data) throw new Error("Attachment unavailable");
  return safeAttachment(data.payload, index);
}

export async function supportAttachmentList(client: any, userId: string, messageId: string) {
  await requireSupportAdmin(client, userId);
  const { data, error } = await client
    .from("support_deliveries")
    .select("payload")
    .eq("message_id", messageId)
    .eq("kind", "owner")
    .maybeSingle();
  if (error || !data) throw new Error("Attachments unavailable");
  return (data.payload?.attachments ?? []).map((_: unknown, index: number) => ({
    index,
    label: `Stored attachment ${index + 1}`,
  }));
}