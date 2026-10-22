// The OAuth client record uses the name and redirect host the app registered
// (often "Cursor" and www.cursor.com). Members see a product name instead,
// and never the return domain.

export type ConsentClientInput = {
  name?: string | null;
  redirectUri?: string | null;
};

const LABELS = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  grok: "Grok Bot",
} as const;

type Family = keyof typeof LABELS;

function hostnameOf(redirectUri: string | null | undefined): string {
  if (!redirectUri) return "";
  try {
    return new URL(redirectUri).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostIs(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

function familyFromHost(hostname: string): Family | null {
  if (!hostname) return null;
  // Cursor's registered redirect is on cursor.com. That connect is Grok Bot.
  if (hostIs(hostname, "cursor.com")) return "grok";
  if (hostIs(hostname, "grok.com") || hostname.split(".").includes("grok")) return "grok";
  if (hostIs(hostname, "chatgpt.com") || hostIs(hostname, "openai.com")) return "chatgpt";
  if (hostIs(hostname, "claude.ai") || hostIs(hostname, "anthropic.com")) return "claude";
  return null;
}

function familyFromName(name: string | null | undefined): Family | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  if (/chatgpt|chat\s*gpt/i.test(n) || /\bopenai\b/i.test(n)) return "chatgpt";
  if (/\bclaude\b/i.test(n) || /\banthropic\b/i.test(n)) return "claude";
  if (/\bgrok\b/i.test(n)) return "grok";
  return null;
}

/** ChatGPT, Claude, or Grok Bot when we know the app. Otherwise "your AI". */
export function consentClientLabel(input: ConsentClientInput = {}): string {
  const family = familyFromHost(hostnameOf(input.redirectUri)) ?? familyFromName(input.name);
  return family ? LABELS[family] : "your AI";
}

export function consentConnectTitle(label: string = "your AI"): string {
  return `Connect ${label} to Athena`;
}
