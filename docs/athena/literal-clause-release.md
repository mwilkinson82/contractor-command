# Automatic literal source clauses

Baseline: PR 324, source `fff32e23ee00f9fed57654b2b9448fb97cfa207c`,
deployment `2fafa0d0-6250-4443-8b0b-5aebbbe7326e`.

Uploading a contract/spec to the selected company/job establishes its association
and use. There is no extra approval, digest, confirmation or activation workflow.
The existing extraction pass automatically persists a literal section/page index
beside the complete readable JSON and original in the existing private
`athena-documents` company/job/upload directory. No migration, service, provider,
credential or permission change is required.

The index stores section headings and exact character spans into the saved page
text, tied to source ID, original hash, readable-text hash and extraction/index
versions. It covers every character of every physical page, including unnumbered
and blank pages. Atomic immutable upload and read-back validation protect coverage.
Repeated extraction preparation reuses both saved artifacts without parsing the
PDF again. The index contains no inferred legal facts or approved-term state.

`contract_terms` reads exact extracted notice clauses, physical-page citations,
source filenames/IDs and explicit source issues. Responses paginate and label
excerpts that continue. It no longer presents an empty legacy summary as the
available source text. Existing readable documents without an index remain usable
directly; no activation or owner action is needed. Legacy-only jobs retain their
existing card and values. Source read calls do not write records.

CPM receives the source clauses as context. Delay intake uses an automatic clock
only when the literal wording supplies one unambiguous numeric day count, day type
and trigger; an Architect-decision claim is not calculated from delay start.
Compound, conflicting and nonnumeric wording remains literal and explicit.
Submittal logging uses a clear source review period when present; existing planning
configuration stays labeled as an assumption when the source gives no numeric
review period. Historical due dates and unrelated facts are not backfilled.

Original files, canonical source rows, upload identity, existing access, Hub,
authentication, connector and outbound-send rules are preserved. Job 2701's source
identity issue is not resolved or rewritten here. PR 311/320 and AJ remain outside
this release. No notice or external commitment is sent by extraction.

Verification: source-character partition and checksum, complete 450-page original
Office source (sections 8.4.4/14.2.2/14.3.1 on PDF pages 107/149/150), repeat reuse,
source/hash/path mismatch, incomplete/corrupt index, no-write card/CPM reads,
legacy-index fallback, wrong-job/company isolation, compound/unknown clocks,
existing upload/Workers/role regressions, manifest wire equality and build.

Rollback: restore and publish baseline PR 324 through the existing Lovable project.
Derived index objects can remain private and unused; no schema, canonical data or
original file rollback/deletion is needed. No automatic source extraction is an
authorization to send a notice or make an external commitment.
