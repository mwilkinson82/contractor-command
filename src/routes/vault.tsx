import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { vault, type Packet } from "@/lib/vault";
import { PageHeader, Container } from "@/components/portal/page-header";
import { PacketCard } from "@/components/portal/packet-card";

export const Route = createFileRoute("/vault")({
  head: () => ({ meta: [{ title: "Company Vault — ALP Contractor Circle" }] }),
  component: VaultPage,
});

function VaultPage() {
  const [packets, setPackets] = useState<Packet[]>([]);

  useEffect(() => {
    const load = () => setPackets(vault.list());
    load();
    window.addEventListener("vault:changed", load);
    return () => window.removeEventListener("vault:changed", load);
  }, []);

  return (
    <Container>
      <PageHeader
        eyebrow="Company Vault"
        title="Your operating memory."
        lede="Command Packets, Bring One Issue packets, and decisions worth keeping. Carry the right ones into AOS."
        actions={
          <>
            <Link to="/tools/growth-constraint" className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm hover:bg-muted">
              Run a command tool
            </Link>
            <Link to="/calls" hash="submit-topic" className="rounded-lg bg-ink px-4 py-2.5 text-sm text-cream hover:opacity-90">
              Submit a topic
            </Link>
          </>
        }
      />

      <div className="mt-10">
        {packets.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/50 p-16 text-center">
            <p className="label-mono">Empty</p>
            <h2 className="mt-3 font-display text-2xl">No command packets saved yet.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Run a command tool, save the packet, and use it to decide what belongs in AOS.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Link to="/tools/growth-constraint" className="rounded-lg bg-ink px-4 py-2.5 text-sm text-cream hover:opacity-90">
                Open Growth Constraint Map
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            {packets.map((p) => (
              <PacketCard key={p.id} packet={p} onChange={() => setPackets(vault.list())} />
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}
