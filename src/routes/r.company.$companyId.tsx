import { createFileRoute, notFound } from "@tanstack/react-router";
import { isUuid } from "@/lib/report-pages";
import { CompanyBoard } from "@/components/athena/CompanyBoard";

// Company board (Nov 5 2026): the company's profile, kinds of work, labor rules, authority, tools, and the company
// details and logo editor. Signed-in members of the company only; the database decides access.
export const Route = createFileRoute("/r/company/$companyId")({
  head: () => ({ meta: [{ title: "Athena company board" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: ({ params }) => {
    if (!isUuid(params.companyId)) throw notFound();
  },
  component: CompanyBoardPage,
});

function CompanyBoardPage() {
  const { companyId } = Route.useParams();
  return <CompanyBoard companyId={companyId} />;
}
