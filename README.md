# check-decisions

> Unreleased version 2 project-link support. Existing published tags do not contain this change. Test this branch by exact commit SHA; release is blocked until production serves PRE-210 and the matching configuration has been verified end to end.

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
      - uses: Imgntech/check-decisions@<verified-candidate-commit-sha>
        with:
          token: ${{ secrets.PRECEDENT_TOKEN }}
```

`PRECEDENT_TOKEN` is a CI token from Settings, Your preferences in Precedent: read only, optionally limited to one Area, revocable under Settings, Assistants.

The repository needs the version 2 `.precedent.json` that the assistant's `setup_project` writes. Its `checkAreaIds`, one to three Areas, are checked; `recordAreaId` is where the assistant proposes decisions and the Action ignores it. An optional `paths` list maps globs to Areas (`{ "glob": "…", "areaId": "…" }`); a changed file matching no glob is checked in `checkAreaIds`. A version 1 file is refused: set the project up again with `setup_project` and commit the new file.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Verification

Run `node --test tests/check-decisions-action.test.mjs` (Node 20 or later). The mocked suite makes no network or AI calls. It is copied from the maintained source with only its import path changed.

## Publishing

Implementation and tests are synced from Precedent commit `1e2e89d9e7134cb96116e5de37714afe1afc1016` (PRE-210). The HTTP `pr-check` endpoint still accepts `nodeIds`; the Action maps the new configuration names to that unchanged parameter.

Do not publish or move tags until production serves PRE-210, `setup_project` returns a version 2 project link, and a private fixture verifies the candidate against that configuration. Version 1 project files are deliberately refused. Commit the newly generated configuration together with selecting the matching Action release.

Release version and floating tag are to be confirmed before rollout. Preserve existing `v1.0.0` and `v1.1.0` tags. Publishing this Action is separate from deploying Precedent or releasing its assistant plugin.
