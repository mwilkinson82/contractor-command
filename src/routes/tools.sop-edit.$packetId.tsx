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
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">Edit SOP failed</p>
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
        const found = await vault.getById(packetId);
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
        const raw = (found.inputs?.sopDocument as string | undefined) ?? null;
        if (!raw) {
          setError("This packet doesn't have an editable SOP document attached.");
          setLoading(false);
          return;
        }
        const parsed = JSON.parse(raw) as SopDocument;
        setPacket(found);
        setDoc(parsed);
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

  if (loading) {
    return (
      <div className="mx-auto flex max-w-xl items-center justify-center gap-3 px-6 py-24">
        <Loader2 className="h-4 w-4 animate-spin text-foreground/70" />
        <p className="text-[13px] text-foreground/80">Loading SOP…</p>
      </div>
    );
  }

  if (error || !doc || !packet) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
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
    );
  }

  // Synthesize a backlog item so the builder has the metadata it expects.
  // In edit mode the builder doesn't re-call the AI draft endpoint, so these
  // fields are only used for labels and the localStorage cache key.
  const syntheticItem: SopBacklogItem = {
    rank: 1,
    playId: "edit",
    name: `${doc.title} · ${packetId}`,
    purpose: doc.purpose,
    trigger: doc.trigger,
    owner: doc.owner,
    dependsOn: [],
    effort: "M",
    why: "Editing previously saved SOP.",
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-8">
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
        onBack={() => navigate({ to: "/vault" })}
        initialDoc={doc}
        existingPacketId={packetId}
      />
    </div>
  );
}
