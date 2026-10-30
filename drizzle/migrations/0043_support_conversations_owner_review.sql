-- Private conversation evidence and independent durable deliveries. No customer-facing policies.
-- Deploy only after review; legacy rows are preserved without resending completed mail.
drop index public.support_tickets_message_id_uidx;
create index support_tickets_message_id_scope_uidx on public.support_tickets(brand, from_email, message_id) where message_id is not null;
revoke execute on function public.open_support_ticket(text,text,text,text,text,timestamptz,text) from service_role;

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id),
  brand text not null check (brand in ('athena','circle')),
  from_email text not null,
  resend_email_id text not null unique,
  message_id text,
  received_at timestamptz not null,
  evidence jsonb not null,
  receipt_message_id text not null unique,
  preview boolean not null default true,
  sender_verified boolean not null default false,
  legacy_import boolean not null default false,
  review_reason text,
  suppressed_reason text,
  ack_sent_at timestamptz,
  owner_sent_at timestamptz
);
create index support_messages_ticket_idx on public.support_messages(ticket_id, received_at);
create table public.support_deliveries (
  message_id uuid not null references public.support_messages(id),
  kind text not null check(kind in ('ack','owner')),
  payload jsonb not null,
  state text not null default 'retry' check(state in ('retry','sending','sent','review')),
  first_attempt_at timestamptz,
  lease_until timestamptz,
  token uuid,
  attempts integer not null default 0,
  primary key(message_id,kind)
);
alter table public.support_messages enable row level security;
alter table public.support_deliveries enable row level security;
revoke all on public.support_messages, public.support_deliveries from public, anon, authenticated;
grant select,insert,update on public.support_messages, public.support_deliveries to service_role;

insert into public.support_messages(ticket_id,brand,from_email,resend_email_id,message_id,received_at,evidence,receipt_message_id,preview,legacy_import,review_reason,suppressed_reason,ack_sent_at,owner_sent_at)
select id,brand,from_email,resend_email_id,message_id,received_at,
  jsonb_build_object('legacy_summary',raw_summary,'original_requires_retrieval',true),
  '<legacy-' || gen_random_uuid() || '@invalid.local>', true, true, 'legacy_requires_review',
  coalesce(autoreply_suppressed_reason,'legacy_requires_review'),autoreply_sent_at,notify_sent_at
from public.support_tickets;

create function public.record_support_message(
 _resend_email_id text, _brand text, _from_email text, _subject text, _message_id text,
 _received_at timestamptz, _raw_summary text, _evidence jsonb, _references text[],
 _review_reason text, _preview boolean, _suppressed_reason text, _sender_verified boolean
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
 m public.support_messages%rowtype;
 t public.support_tickets%rowtype;
 candidate uuid;
 candidates integer;
 n integer;
 inserted boolean := false;
 review text := _review_reason;
 sender text := lower(btrim(_from_email));
 domain text;
begin
 if _brand is null or _brand not in ('athena','circle') or sender is null
   or sender !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   or coalesce(length(_resend_email_id),0) not between 1 and 200
   or coalesce(length(_message_id),0) > 998
   or coalesce(cardinality(_references),0) > 50 then raise exception 'invalid support input'; end if;
 -- Serialize ingestion only (not delivery), including conflicting brands/replay IDs.
 perform pg_advisory_xact_lock(782391204);
 select * into m from public.support_messages where resend_email_id = _resend_email_id;
 if found and (m.brand <> _brand or m.from_email <> sender) then raise exception 'support identity mismatch'; end if;
 if m.id is not null and not m.legacy_import and m.evidence is distinct from _evidence then
   raise exception 'provider evidence mismatch requires review';
 end if;
 -- Only provider IDs establish replay identity. Retain reused customer Message-IDs
 -- separately, quarantined, without substituting pending original evidence.
 if m.id is null and _message_id is not null and exists(
   select 1 from public.support_messages where brand=_brand and from_email=sender and message_id=_message_id
 ) then review := 'message_id_reuse_requires_review'; end if;
 if m.id is null then
   if exists(select 1 from public.support_messages where receipt_message_id=any(coalesce(_references,'{}'))
     and (brand<>_brand or from_email<>sender)) then review := 'reference_identity_mismatch'; end if;
   if coalesce(cardinality(_references),0)>0 and not coalesce(_sender_verified,false) then
     review := coalesce(review,'unverified_sender_for_correlation');
   end if;
   -- Only provider-verified sender identity plus a sent LIVE receipt can correlate.
   -- Customer-controlled Message-ID or subject ticket numbers never authorize joining.
   select count(distinct ticket_id), (array_agg(distinct ticket_id))[1] into candidates,candidate
     from public.support_messages where receipt_message_id=any(coalesce(_references,'{}'))
       and brand=_brand and from_email=sender and not preview and ack_sent_at is not null
       and review_reason is null;
   if review is null and coalesce(_sender_verified,false) and candidates=1 then
     select * into t from public.support_tickets where id=candidate;
   elsif candidates > 1 then review := 'ambiguous_references';
   elsif coalesce(cardinality(_references),0)>0 then review := coalesce(review,'unverified_references');
   elsif coalesce(_subject,'') ~* '\[(ATH|CIR)-[0-9]+\]' then review := coalesce(review,'unverified_ticket_number');
   end if;
   if t.id is null then
     update public.support_ticket_counters set last_number=last_number+1 where brand=_brand returning last_number into n;
     if n is null then raise exception 'missing support counter'; end if;
     insert into public.support_tickets(ticket_number,brand,from_email,subject,message_id,received_at,raw_summary,resend_email_id)
       values((case when _brand='athena' then 'ATH-' else 'CIR-' end)||lpad(n::text,greatest(4,length(n::text)),'0'),
       _brand,sender,left(_subject,500),_message_id,_received_at,left(_raw_summary,4000),_resend_email_id)
       returning * into t;
   else
     update public.support_tickets set status='open' where id=t.id;
   end if;
   domain := case when _brand='athena' then 'meetathena.io' else 'alpcontractorcircle.com' end;
   insert into public.support_messages(ticket_id,brand,from_email,resend_email_id,message_id,received_at,evidence,receipt_message_id,preview,review_reason,suppressed_reason,sender_verified)
     values(t.id,_brand,sender,_resend_email_id,_message_id,_received_at,_evidence,
       '<support-'||gen_random_uuid()||'@'||domain||'>',coalesce(_preview,true),review,_suppressed_reason,coalesce(_sender_verified,false)) returning * into m;
   inserted := true;
 else
   select * into t from public.support_tickets where id=m.ticket_id;
 end if;
 return to_jsonb(t) || jsonb_build_object('inserted',inserted,'message_record_id',m.id,
   'receipt_message_id',m.receipt_message_id,'review_reason',m.review_reason,'ack_preview',m.preview,'legacy_import',m.legacy_import,
   'autoreply_sent_at',m.ack_sent_at,'notify_sent_at',m.owner_sent_at,'autoreply_suppressed_reason',m.suppressed_reason);
end $$;

create function public.claim_support_delivery(_message_id uuid,_kind text,_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare d public.support_deliveries%rowtype; m public.support_messages%rowtype; expected_to text; expected_from text;
begin
 select * into m from public.support_messages where id=_message_id;
 if not found or _kind is null or _kind not in ('ack','owner') then raise exception 'invalid delivery'; end if;
 -- Imported delivery outcomes are historical/uncertain: never reconstruct or resend.
 if m.legacy_import then
   return jsonb_build_object('state','review','token',null,'payload','{}'::jsonb);
 end if;
 if _kind='ack' and (m.review_reason is not null or m.suppressed_reason is not null) then
   return jsonb_build_object('state','review','token',null,'payload','{}'::jsonb);
 end if;
 expected_to := case when _kind='owner' or m.preview then 'marshall@marshallwilkinson.com' else m.from_email end;
 expected_from := case when m.brand='athena' then 'Athena Support <support@meetathena.io>' else 'Circle Support <support@alpcontractorcircle.com>' end;
 if _payload->'to' is distinct from jsonb_build_array(expected_to) or _payload->>'from' is distinct from expected_from
    or _payload ? 'cc' or _payload ? 'bcc' or _payload ? 'reply_to' then raise exception 'invalid delivery recipients'; end if;
 insert into public.support_deliveries(message_id,kind,payload) values(_message_id,_kind,_payload) on conflict do nothing;
 select * into d from public.support_deliveries where message_id=_message_id and kind=_kind for update;
 if d.state='sent' or (_kind='ack' and m.ack_sent_at is not null) or (_kind='owner' and m.owner_sent_at is not null) then
   return jsonb_build_object('state','sent','token',null,'payload',d.payload);
 end if;
 -- A timeout after provider acceptance is uncertain. Never retry beyond its 24h key lifetime.
 if d.state='review' or d.first_attempt_at < now()-interval '23 hours' then
   update public.support_deliveries set state='review' where message_id=_message_id and kind=_kind;
   return jsonb_build_object('state','review','token',null,'payload',d.payload);
 end if;
 if d.state='sending' and d.lease_until > now() then return jsonb_build_object('state','busy','token',null,'payload',d.payload); end if;
 update public.support_deliveries set state='sending',first_attempt_at=coalesce(first_attempt_at,now()),
   lease_until=now()+interval '2 minutes',token=gen_random_uuid(),attempts=attempts+1
   where message_id=_message_id and kind=_kind returning * into d;
 return jsonb_build_object('state','ready','token',d.token,'payload',d.payload);
end $$;

create function public.finish_support_delivery(_message_id uuid,_kind text,_token uuid,_result text)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if _result is null or _result not in ('sent','retry','review') then raise exception 'invalid outcome'; end if;
 update public.support_deliveries set state=_result,lease_until=null
   where message_id=_message_id and kind=_kind and token=_token and state='sending';
 if not found then raise exception 'stale delivery claim'; end if;
 if _result='sent' then
   if _kind='ack' then update public.support_messages set ack_sent_at=now() where id=_message_id;
   else update public.support_messages set owner_sent_at=now() where id=_message_id; end if;
 end if;
end $$;

revoke all on function public.record_support_message(text,text,text,text,text,timestamptz,text,jsonb,text[],text,boolean,text,boolean),
 public.claim_support_delivery(uuid,text,jsonb), public.finish_support_delivery(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_support_message(text,text,text,text,text,timestamptz,text,jsonb,text[],text,boolean,text,boolean),
 public.claim_support_delivery(uuid,text,jsonb), public.finish_support_delivery(uuid,text,uuid,text) to service_role;
