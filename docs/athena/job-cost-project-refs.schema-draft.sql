-- LOCAL INTEGRATION DRAFT ONLY. Not a managed migration; do not apply directly.
-- Requires the exact reviewed PO and cost producers. Preserve optional links and
-- existing JSON facts; do not invent supplier identities or require a PO for expenses.
-- Runtime writers still enforce company/job/party and snapshot identity. These
-- constraints make the accepted identities durable under later privileged maintenance.
ALTER TABLE public.mcp_cost_submission_versions
 ADD COLUMN project_party_ref uuid GENERATED ALWAYS AS ((facts->>'party_id')::uuid) STORED,
 ADD COLUMN purchase_order_ref uuid GENERATED ALWAYS AS ((facts->>'purchase_order_id')::uuid) STORED,
 ADD COLUMN purchase_order_version_ref integer GENERATED ALWAYS AS ((facts->>'purchase_order_version')::integer) STORED;
ALTER TABLE public.mcp_cost_submission_versions
 ADD CONSTRAINT mcp_cost_version_party_ref FOREIGN KEY(project_party_ref) REFERENCES public.mcp_project_parties(id),
 ADD CONSTRAINT mcp_cost_version_po_ref FOREIGN KEY(purchase_order_ref) REFERENCES public.mcp_purchase_orders(id),
 ADD CONSTRAINT mcp_cost_version_po_revision_ref FOREIGN KEY(purchase_order_ref,purchase_order_version_ref) REFERENCES public.mcp_purchase_order_versions(po_id,version),
 ADD CONSTRAINT mcp_cost_version_po_ref_complete CHECK (
   (purchase_order_ref IS NULL AND purchase_order_version_ref IS NULL) OR
   (purchase_order_ref IS NOT NULL AND purchase_order_version_ref IS NOT NULL AND project_party_ref IS NOT NULL)
 );
-- Supporting indexes prevent full scans of the referencing side during maintenance.
-- Choose the coordinated locking/online strategy before generating a final migration.
CREATE INDEX mcp_cost_version_party_ref_idx ON public.mcp_cost_submission_versions(project_party_ref) WHERE project_party_ref IS NOT NULL;
CREATE INDEX mcp_cost_version_po_revision_ref_idx ON public.mcp_cost_submission_versions(purchase_order_ref,purchase_order_version_ref) WHERE purchase_order_ref IS NOT NULL;
