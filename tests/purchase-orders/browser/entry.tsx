import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PurchaseOrdersPage } from "../../../src/components/athena/PurchaseOrdersPage";
const c = (window as unknown as { PO_FIXTURE: { job: string; buyout: boolean } }).PO_FIXTURE;
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <PurchaseOrdersPage jobId={c.job} initialTab={c.buyout ? "suppliers" : "orders"} />
  </QueryClientProvider>,
);
