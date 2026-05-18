## Goal

Move all outgoing app emails (SOP delivery, transactional sends) from the old sender `notify.alpos.alpcontractorcircle.com` to the new verified sender `notify.mail.alpcontractorcircle.com`.

## Status right now

- New domain `notify.mail.alpcontractorcircle.com` is added and **Verifying DNS** (Lovable NS records published; can take up to 72h to propagate)
- Old domain `notify.alpos.alpcontractorcircle.com` is still the active sender in code
- DNS records you added for the new domain are correct
- The leftover `alpos.alpcontractorcircle.com` NS records at your registrar are harmless — independent zone, no conflict

## What I'll change once DNS verifies

1. **Swap sender constants** in `src/routes/lovable/email/transactional/send.ts`:
   - `SENDER_DOMAIN` → `notify.mail.alpcontractorcircle.com`
   - `FROM_DOMAIN` → `notify.mail.alpcontractorcircle.com`
   - From-header will read: `AOS <noreply@notify.mail.alpcontractorcircle.com>`

2. **Update the visible sender label** in `src/components/portal/tools/sop-document-builder.tsx` (currently shows `mail.alpcontractorcircle.com`) so the UI matches the actual From address.

3. **Send a test SOP email** to confirm delivery from the new domain and that it lands in Primary (not Updates) more reliably than the old subdomain.

## Old domain cleanup (optional, after cutover)

Once the new sender is confirmed working:

- Disable `notify.alpos.alpcontractorcircle.com` in Cloud → Emails
- At your registrar, remove the old NS records:
  - `notify.alpos.alpcontractorcircle.com NS ns3.lovable.cloud` (or ns5/ns6 — whichever was issued)
  - `notify.alpos.alpcontractorcircle.com NS ns4.lovable.cloud`
- Leave the `mail.alpcontractorcircle.com` zone alone — it's the parent of the new active sender

## What you need to do

- **Now:** nothing — wait for DNS to flip to **Active** in Cloud → Emails (usually under an hour, sometimes longer)
- **When it's Active:** tell me "DNS is verified" (or just "cut it over") and I'll flip the constants and ship a test

## Deliverability note

`notify.mail.alpcontractorcircle.com` is a fresh sending subdomain, so the first few sends may still land in Gmail's **Updates** tab while reputation builds. That's normal for any new domain — it improves over the first week or two of regular sending.
