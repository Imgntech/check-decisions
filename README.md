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
      - uses: Imgntech/check-decisions@v1
        with:
          token: ${{ secrets.PRECEDENT_TOKEN }}
```

`PRECEDENT_TOKEN` is a CI token from Settings, Your preferences in Precedent: read only, optionally limited to one Area, revocable under Settings, Assistants.

The repository needs the `.precedent.json` that the assistant's `setup_project` writes. Its `checkNodeIds`, one to three Areas, are checked; `recordNodeId` is where the assistant proposes decisions and the Action ignores it. An optional `paths` list maps globs to Areas; a changed file matching no glob is checked in `checkNodeIds`.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Migration from v1.0.0

v1.1.0 uses the current project link: replace `checkNodeId` with `checkNodeIds: ["<Area id>"]`, or ask your assistant to run `setup_project`. The project link's `version` remains `1`. The Action checks only `checkNodeIds` and optional `paths`; it no longer implicitly checks `recordNodeId`. Add the recording Area explicitly to `checkNodeIds` if it must also be checked, within the three-Area limit.

This pre-launch update changes the configuration accepted by the floating `v1` tag. Update your project link before using it. The immutable `v1.0.0` tag remains on the previous implementation for callers that need the old format.

## Verification

Run `node --test tests/check-decisions-action.test.mjs` (Node 20 or later). These mocked tests make no network or AI calls. The suite is copied from the maintained source with only its import path changed for this repository's root layout.

## Publishing

The public repository `Imgntech/check-decisions` holds a copy of `action.yml` and `index.mjs` from `actions/check-decisions/` in the Precedent repository. This update is sourced from `77f9fcdbf8e1d0ee7460179ce0e2ecbc4b6855ff`. Keep the README usage and migration instructions aligned with the published major version.

After approval and verification, tag the merged commit `v1.1.0` and move the floating `v1` tag to that commit. Preserve `v1.0.0` on its original commit. This explicitly approved pre-launch release changes the configuration contract within v1; future breaking changes should use a new major version. Publishing the Action is separate from deploying the Precedent application.
