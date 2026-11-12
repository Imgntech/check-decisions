# check-decisions

A GitHub Action that comments on a pull request with the Precedent decisions that apply to the Areas it touches, and fails the check only on recorded facts:

- `expired-exception`: a decided exception tagged with a checked Area is past its date.
- `superseded-ref`: the pull request's title, description or commits cite a superseded decision. The comment names the successor.

Everything else (expiring exceptions, overdue reviews, current decisions that depend on superseded ones) is informational. Search similarity never fails the check.

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  pull-requests: write
  contents: read
jobs:
  decisions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Imgntech/check-decisions@v2
        with:
          token: ${{ secrets.PRECEDENT_TOKEN }}
```

`PRECEDENT_TOKEN` is a CI token from Settings, Your preferences in Precedent: read only, optionally limited to one Area, revocable under Settings, Assistants.

The repository needs the `.precedent.json` that the assistant's `setup_project` writes. Its `checkNodeIds`, one to three Areas, are checked; `recordNodeId` is where the assistant proposes decisions and the Action ignores it. An optional `paths` list maps globs to Areas; a changed file matching no glob is checked in `checkNodeIds`.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Migration from v1

v2 uses the current project link: replace `checkNodeId` with `checkNodeIds: ["<Area id>"]`, or ask your assistant to run `setup_project`. The project link's `version` remains `1`. The Action checks only `checkNodeIds` and optional `paths`; it no longer implicitly checks `recordNodeId`. Add the recording Area explicitly to `checkNodeIds` if it must also be checked, within the three-Area limit.

v1 and v1.0.0 remain unchanged for existing configurations. Select v2 only after updating your project link.

## Verification

Run `node --test tests/check-decisions-action.test.mjs` (Node 20 or later). These mocked tests make no network or AI calls. The suite is copied from the maintained source with only its import path changed for this repository's root layout.

## Publishing

The public repository `Imgntech/check-decisions` holds a copy of `action.yml` and `index.mjs` from `actions/check-decisions/` in the Precedent repository. This update is sourced from `77f9fcdbf8e1d0ee7460179ce0e2ecbc4b6855ff`. Keep the README usage and migration instructions aligned with the published major version.

After the PR is approved, merged and verified through the private fixture repository, tag that exact commit `v2.0.0` and create `v2` at the same commit. Do not move `v1` or `v1.0.0`: rejecting the old configuration and no longer checking the recording Area implicitly are breaking changes. Subsequent compatible v2 releases get a new immutable version tag and move only the floating `v2` tag. Publishing the Action is separate from deploying the Precedent application.
