# Complete reusable PDF text

Release baseline: `4bbcd2ce95e93f54d1d287403d77d3f0be7ad6dc` (PR 323).

The Office Building Alteration source has 450 physical PDF pages; its existing
400,000-character clause cache ends partway through page 148. Original bytes are
intact. This change preserves that cache and the original and stores a separate
complete, immutable, page-organized readable JSON document in the existing private
`athena-documents` bucket, under the same company/job/upload prefix. No migration,
bucket, permission, RLS, provider or service changes are required.

Identity includes canonical source ID, original SHA-256 and byte count, company,
job, extraction version, preparation time, complete physical-page coverage and a
text checksum. A changed original hash selects a different derived object; stale,
partial or corrupt representations are refused. An object becomes ready only
after one atomic upload and successful read-back validation. There is no silent
text cutoff. If the complete derived object exceeds the existing 100 MB limit,
preparation explicitly fails and preserves the original.

New PDF uploads reuse the same extraction pass to prepare the readable document.
Existing sources use the explicit `file_upload` action `prepare_readable` with the
exact `document_id`; this creates no upload session and changes no canonical
source or inferred contract facts. Repeated preparation is idempotent. A failed
preparation is reported separately from a successful original upload.

`project_documents` remains read-only. Reads/searches reuse the saved representation
without downloading or parsing the PDF. Missing extraction permits verified
original-backed bounded page reading as a fallback; readiness and completeness
are explicit. Search selects a document first and scans 100 physical pages per
call; continue at `next_pdf_page` until null and retain prior coverage. Dense page
reads expose `next_text_offset` and accept `text_offset`. Limited hit lists are
explicit. Image-only pages have no implied OCR. Neither complete page extraction
nor reading proves that the complete executed contract set was supplied.

Do not break: original hashes, job/company access, uploader-independent authorized
member access, contract/spec distinction, source IDs, existing upload replay,
contract terms and card behavior, drawing/Hub/auth/connector workflows. PR 311,
PR 320, historical CO, customer records and outbound delivery remain outside this
release. No source upload is repeated for acceptance.

Rollback: restore the managed Lovable source at baseline PR 323, publish using the
existing project and verify live deployment identity and the saved-source read
baseline. Derived objects can remain private and unused; no data deletion or
schema rollback is needed. Do not alter original objects or customer facts.

Verification includes synthetic text beyond 400,000 characters, physical pages
149 and final, dense-page and search continuation, explicit hit limits, invalid
PDF queue recovery, byte/hash/path mismatch, storage failure, concurrent atomic
publication, stale/incomplete/corrupt extraction, exact existing-source preparation,
no source/fact writes during read, real unchanged Postgres storage RLS for derived
objects, SDK tools/list schema equality, complete regression suite and production
build. Optional private Office and Transportation fixtures never enter Git.
