type CompanyChoice = { id?: string; name: string };

/** Same-name workspaces need a reference the next tool call can use exactly. */
export function companyChoiceLabel(company: CompanyChoice, companies: readonly CompanyChoice[]) {
  const name = company.name.trim().toLowerCase();
  const ambiguous = companies.filter((c) => c.name.trim().toLowerCase() === name).length > 1;
  return ambiguous && company.id ? `${company.name} (company ID: ${company.id})` : company.name;
}

export function ambiguousCompanyMessage(name: string, companies: readonly CompanyChoice[]) {
  return `More than one of your companies is called "${name.trim()}". Choose one of these companies: ${companies.map((c, index) => `${index + 1}. ${companyChoiceLabel(c, companies)}`).join("; ")}. Use that choice's company ID on the next call. Nothing was changed.`;
}
