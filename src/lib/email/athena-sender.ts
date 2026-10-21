// The one place the Athena auth-email sender is set.
// INTERIM: meetathena.io is not yet a Lovable email sender domain, so Athena
// mail goes out from the verified Circle notify subdomain under the Athena
// display name. When meetathena.io (e.g. notify.meetathena.io) is verified in
// Lovable Cloud > Emails, change ATHENA_SENDER_DOMAIN only.
export const ATHENA_SENDER_NAME = "Athena";
export const ATHENA_SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
export const ATHENA_FROM = `${ATHENA_SENDER_NAME} <no-reply@${ATHENA_SENDER_DOMAIN}>`;
