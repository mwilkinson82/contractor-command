// Edit a previously-vaulted SOP. Loads the saved doc from the Company Vault
// and renders the SOP Document Builder in edit mode — saves overwrite the
// same packet instead of creating a duplicate.

import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { vault, type Packet } from "@/lib/vault";
import { SopDocumentBuilder } from "@/components/portal/tools/sop-document-builder";
import type { SopDocument } from "@/lib/tools/sop-draft";
import type { SopBacklogItem } from "@/lib/tools/sop-department";

export const Route = createFileRoute("/tools/sop-edit/$packetId")({
  head: () => ({ meta: [{ title: "Edit SOP — ALP Contractor Circle" }] }),
  errorComponent: EditSopError,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-2xl">SOP not found</h1>
      <Link
        to="/vault"
        className="mt-4 inline-flex rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream"
      >
        Back to Vault
      </Link>
    </div>
  ),
  component: EditSopPage,
});

function EditSopError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
        Edit SOP failed
      </p>
      <p className="mt-2 text-[13px] text-foreground">{error.message}</p>
      <button
        type="button"
        onClick={() => {
          reset();
          router.invalidate();
        }}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream"
      >
        Try again
      </button>
    </div>
  );
}

function EditSopPage() {
  const { packetId } = Route.useParams();
  const navigate = useNavigate();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [doc, setDoc] = useState<SopDocument | null>(null);
  const [backlogItem, setBacklogItem] = useState<SopBacklogItem | null>(null);
  const [department, setDepartment] = useState<string>("");
  const [parentPlay, setParentPlay] = useState<Parameters<typeof SopDocumentBuilder>[0]["parentPlay"]>(null);
  const [ownerContext, setOwnerContext] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          setError("You need to be signed in to edit a saved SOP.");
          setLoading(false);
          return;
        }
        await vault.hydrateFor(uid);
        if (cancelled) return;
        const found = await vault.getById(packetId, { fresh: true });
        if (!found) {
          setError("This SOP isn't in your vault.");
          setLoading(false);
          return;
        }
        if (found.kind !== "command") {
          setError("That packet isn't an SOP.");
          setLoading(false);
          return;
        }
        const sopRaw = (found.inputs?.sopDocument as string | undefined) ?? null;
        const backlogRaw = (found.inputs?.sopBacklogItem as string | undefined) ?? null;
        const dept = (found.inputs?.department as string | undefined) ?? "";
        const parentRaw = (found.inputs?.parentPlay as string | undefined) ?? "";
        const ctx = (found.inputs?.ownerContext as string | undefined) ?? "";
        setDepartment(dept);
        setOwnerContext(ctx);
        if (parentRaw) {
          try { setParentPlay(JSON.parse(parentRaw)); } catch { setParentPlay(null); }
        }
        if (sopRaw) {
          setDoc(JSON.parse(sopRaw) as SopDocument);
          setPacket(found);
          setLoading(false);
          return;
        }
        if (backlogRaw) {
          try {
            setBacklogItem(JSON.parse(backlogRaw) as SopBacklogItem);
            setPacket(found);
            setLoading(false);
            return;
          } catch {
            // fall through to error
          }
        }
        setError("This packet doesn't have an editable SOP document attached.");
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load SOP.");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packetId]);

  // For doc-mode (already drafted), synthesize a backlog item so the
  // builder has the metadata it expects. In edit mode the builder doesn't
  // re-call the AI draft endpoint, so these fields are only used for
  // labels and the localStorage cache key.
  const syntheticItem: SopBacklogItem | null = backlogItem
    ? backlogItem
    : doc
    ? {
        rank: 1,
        playId: "edit",
        name: `${doc.title} · ${packetId}`,
        purpose: doc.purpose,
        trigger: doc.trigger,
        owner: doc.owner,
        dependsOn: [],
        effort: "M",
        why: "Editing previously saved SOP.",
      }
    : null;


  // IMPORTANT: keep a single stable outer wrapper. The root `useGlobalReveal`
  // effect tags `<main>`'s direct children with `data-reveal` + `is-visible`;
  // if we swap the outer element (or its className) between loading/error/ok
  // states, React's className write strips `is-visible` and the element stays
  // stuck at opacity 0 (blank page). Swap inner content only.
  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-8">
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-24">
          <Loader2 className="h-4 w-4 animate-spin text-foreground/70" />
          <p className="text-[13px] text-foreground/80">Loading SOP…</p>
        </div>
      ) : error || !doc || !packet || !syntheticItem ? (
        <div className="mx-auto max-w-xl py-16 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Can't open this SOP
          </p>
          <p className="mt-2 text-[13px] text-foreground">{error ?? "Missing SOP data."}</p>
          <Link
            to="/vault"
            className="mt-4 inline-flex rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream"
          >
            Back to Vault
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate({ to: "/vault" })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Vault
            </button>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Editing saved SOP
            </p>
          </div>
          <SopDocumentBuilder
            item={syntheticItem}
            department={doc.department}
            parentPlay={null}
            onBack={() => navigate({ to: "/tools", search: { t: "sop-priority" } })}
            initialDoc={doc}
            existingPacketId={packetId}
          />
        </>
      )}
    </div>
  );
}
