/** One package engine; each purpose supplies its own construction content. */
export const PACKAGE_PURPOSES = ["approval", "rfi", "rfc", "change_order"] as const;
export type PackagePurpose = (typeof PACKAGE_PURPOSES)[number];
export type PackageReference = {
  kind: "drawing" | "spec" | "contract" | "condition";
  citation: string;
  source_id?: string | null;
  revision?: string | null;
  page?: number | null;
};
export type RequestDetails = {
  condition: string;
  question: string;
  references: PackageReference[];
  suggested_resolution?: string | null;
  recipient_name?: string | null;
  recipient_role?: "architect" | "engineer" | "owner" | "construction_manager" | "other" | null;
  recipient_email?: string | null;
  state?: "draft" | "sent" | "answered" | "closed";
  record_version?: number;
  due_date?: string | null;
  answer?: {
    text: string;
    received_at: string;
    received_from: string;
    references: PackageReference[];
  } | null;
};

export const PACKAGE_PURPOSE_LABEL: Record<PackagePurpose, string> = {
  approval: "Installation approval submittal",
  rfi: "Request for information",
  rfc: "Request for clarification",
  change_order: "Change order submittal",
};

export function packagePurpose(value: unknown): PackagePurpose {
  if (value == null) return "approval";
  if ((PACKAGE_PURPOSES as readonly unknown[]).includes(value)) return value as PackagePurpose;
  throw new Error("Unknown package purpose. Nothing was built.");
}

/** A citation is not proof that the referenced document has been stored or read. */
export function requestContentGaps(
  details:
    Partial<Pick<RequestDetails, "condition" | "question" | "references">> | null | undefined,
): string[] {
  const gaps: string[] = [];
  const missing = (value: string | undefined) =>
    !value?.trim() || /^(needed|unknown|n\/?a|tbd|pending|not provided)$/i.test(value.trim());
  if (missing(details?.condition)) gaps.push("The condition that needs clarification");
  if (missing(details?.question)) gaps.push("The exact question");
  if (!details?.references?.length)
    gaps.push("A drawing, specification, contract or condition reference");
  else if (details.references.some((ref) => missing(ref.citation)))
    gaps.push("A citation for each reference");
  return gaps;
}

export function requestReferenceText(ref: PackageReference): string {
  return [
    ref.citation,
    ref.revision ? `revision ${ref.revision}` : "",
    ref.page ? `page ${ref.page}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Core submitted status is receipt-backed for request packages by the database trigger. */
export function requestState(row: {
  status: string;
  request_details?: RequestDetails | null;
  submission_sent_at?: string | null;
}) {
  const state = row.request_details?.state;
  if (state === "answered" || state === "closed") return state;
  return row.submission_sent_at || row.status === "submitted" ? "sent" : "draft";
}

/** Factual content shared by the card, record and server-generated package PDF. */
export function requestContent(details: RequestDetails): { heading: string; lines: string[] }[] {
  return [
    { heading: "Condition", lines: [details.condition] },
    { heading: "Question", lines: [details.question] },
    { heading: "References", lines: details.references.map(requestReferenceText) },
    ...(details.suggested_resolution
      ? [{ heading: "Suggested resolution · for review", lines: [details.suggested_resolution] }]
      : []),
  ];
}
