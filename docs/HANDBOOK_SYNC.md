# ALP Handbook synchronization

## Source of truth

`mwilkinson82/alp-hand-book` is the editorial source of truth for Handbook chapter
content. Contractor Circle Hub owns the authenticated reader shell, tier access,
navigation, and Hub-specific presentation.

The canonical paths synchronized into this repository are:

- Substantive reader content in `src/components/handbook/content/*.tsx`
- `src/assets/professional-contractor-control-loop.png`

The unused `PlaceholderChapter.tsx` scaffold is deliberately excluded.

Reader-shell files such as `src/routes/handbook.tsx`, `TableOfContents.tsx`,
`FloatingTOC.tsx`, and `HeroSection.tsx` remain Hub-owned because the standalone
Handbook and the Hub use different routers, authentication, and navigation.

## Automated flow

`.github/workflows/sync-alp-handbook.yml` runs daily and can also be started
manually from GitHub Actions. It checks out the latest `main` branch of the
canonical Handbook, runs the synchronization script, and opens a pull request
when content has changed.

The workflow never deploys or merges automatically. The synchronization PR must
be reviewed and merged before Lovable publishes the updated Hub.

The sync copies canonical files into the Hub but does not delete Hub-only content
files. It reuses one automation branch so a pending synchronization is updated
instead of creating duplicate daily pull requests.

## Local flow

From this repository, run:

```sh
npm run sync:handbook -- --source /absolute/path/to/alp-hand-book
```

Then review the diff, confirm any new content is registered in the Hub reader and
table of contents, and run the normal test and build checks.
