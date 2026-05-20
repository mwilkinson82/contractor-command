## Change

Remove the small 44×44 Contractor Circle logo at the top-left of the invite email. Keep the short orange hairline rule directly underneath — it carries the brand mark on its own and the hero headline becomes the first thing the eye lands on.

## File

- `src/lib/email-templates/invite.tsx` — delete the `<Img ... style={logo} />` block (lines 91–98). Leave the orange `topRule` div directly below it intact.

No other templates, styles, or logic change. Once approved, the next preview in Cloud → Emails will reflect the update; existing sent emails are unaffected.