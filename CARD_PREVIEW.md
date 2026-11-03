# Isolated card acceptance branch

This branch is for the existing owner's Lovable branch preview only. Do not merge or
publish it. Its parent is the exact reviewed renderer candidate
`382d9c16848612450b12dfd1755a9a411b5282c7`.

After the Lovable operator verifies native branch-preview isolation and selects
`codex/email-sov-synthetic-preview`, open `/card-review` in the existing project
preview. The operator must verify this branch's commit before accepting screenshots.
There is no claim that the preview has already been staged or accessed.

The page displays the actual candidate email HTML, SOV HTML and SOV MCP Apps renderer.
All data is synthetic. The iframe is sandboxed with scripts only. The page has no
database client, authenticated session, email provider or host tool transport.
Every requested action is intercepted and rejected; outbound connections and forms
are additionally blocked by the page's Content Security Policy.

Capture all four surfaces at 600 px and 375 px, including keyboard focus, message
preview/edit/undo, link-only disclosure, and readable SOV numeric columns. A mobile
screen narrower than the selected width clamps the frame to its available width.
Clicking Approve and send must show an intercepted-action notice and must not
produce approval or sent status. Links must not open actual records.

This synthetic host proves renderer presentation and isolated interactions, not
live ChatGPT tool selection, provider permissions or actual email delivery. Those
remain separate acceptance checks after the real release is approved.

Restore the original integration branch when finished and verify it. Do not run
migrations, change visibility, create another project or publish this branch.
