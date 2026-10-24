# Read-only job and drawing discovery

`jobs_list` is the explicit portfolio read for “list my jobs.” Without a company
argument it returns every job visible under the caller's existing RLS, grouped
by company. A supplied company name/ID filters the read without writing the
saved current company. This removes the inconsistent portfolio/current-company
interpretation between hosts. The existing company-scoped workflow pickers and
write routing are unchanged. The tool never combines or moves companies/jobs.

`drawing_sets_list` reads a job's stored source records, showing source ID,
filename, revision, creation time and indexed sheets. It does not open an upload
form, import/index a file, download storage objects, create signed links or
return private storage paths/source URLs. An explicit company filter cannot
silently read another company's job. Empty/unindexed libraries are explicit.

Both tools are registered as read-only/idempotent, use the existing ChatGPT card
and Claude native-card resources, and retain complete factual text for other
hosts. They do not trigger a date sweep. The existing card templates, email,
authentication, Hub and access permissions are unchanged.

The forward migration changes only `mcp_drawing_records(uuid)` volatility to
VOLATILE. Its existing membership guard can refresh the gate cache, which a
PostgREST read-only transaction otherwise rejects after cache expiry. Real local
PostgreSQL reproduces that failure, then verifies the same body/ACL succeeds
after the metadata-only change. Apply only through the existing Lovable Cloud
project; no other database API or CLI is a production migration path.

Circle seats continue to mean owner plus five included teammates = six total.
This change does not alter plan quantities or add seats.

Verification covers a 20-job/four-company portfolio despite a two-job current
company, explicit filtering without settings writes, outsider denial, repeat
reads preserving business records, drawing metadata/empty libraries, cache
expiry, palette, actual SDK tools/list annotations/native resource metadata,
and the existing whole-tool guard inventory and locked behaviors. Live host
acceptance waits for an approved publication and tool refresh. Verify all rows
on each host, including jobs under a company other than the saved current one.

After #263 publication, both hosts returned all 20 jobs and the nine CCW-003
drawing records. ChatGPT rendered both cards. Claude initially returned full
facts without a native card; after the tool refresh, a full page reload and new
chat displayed its 20-job native card. The shared label formatter separately
hid source IDs in the text fallback. The source-reference follow-up prints only
that explicitly requested row verbatim in the existing card/text renderers;
other internal IDs retain their current treatment. No handshake, resource or
global formatter changes are needed for that follow-up.
