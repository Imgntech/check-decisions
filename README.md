# check-decisions

> Unreleased Action v2 candidate supporting both version 1 and version 2 project links. Existing published tags do not contain this change. Test this branch by exact commit SHA; merge and release remain held pending production compatibility and verification of this exact candidate.

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

The repository needs a supported `.precedent.json` project link. The Action checks one to three default Areas and any optional path mappings:

| Project version | Checking Areas | Optional path mapping | Recording Area (ignored by the Action) |
| --- | --- | --- | --- |
| `1` | `checkNodeIds` | `{ "glob": "src/billing/**", "nodeId": "<Area id>" }` | `recordNodeId` |
| `2` | `checkAreaIds` | `{ "glob": "src/billing/**", "areaId": "<Area id>" }` | `recordAreaId` |

A changed file matching no glob is checked in the default checking Areas. Path mappings select Areas for matching files; the recording Area is never implicitly checked. Existing token scope and server permission checks still apply.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Verification

Run `node --test tests/check-decisions-action.test.mjs` (Node 20 or later). The mocked suite makes no network or AI calls. It is copied from the maintained source with only its import path changed.

## Migration to Action v2

Action v2 is the planned new major release; it is separate from the project file's `version`. This candidate accepts existing version 1 links using `checkNodeIds` without rewriting them. The older single-Area `checkNodeId` format is not supported: convert it to `checkNodeIds: ["<Area id>"]` while retaining `version: 1`, or use `setup_project` on a compatible server.

To adopt version 2 project links, use `setup_project` on a server that supports them. Preserve existing optional path mappings when saving the generated link, translating each `paths.nodeId` to `paths.areaId`. Keep the intended checking Areas and recording Area. Do not give a version 2 file to an older published Action that only reads version 1; select a compatible Action candidate or released version together with that configuration.

## Publishing

Implementation, `action.yml` and tests are synced from verified Precedent commit `956dacac3b5aa21a7a30d35526ce5b7b6469182c` (PRE-241). Only the test import path changes for this repository's layout. The HTTP `pr-check` endpoint still accepts `nodeIds`; both project formats map to that unchanged parameter.

The next approved major is v2. No v2 release or tag is published by this draft. Preserve all existing v1 tags, including immutable `v1.0.0` and `v1.1.0`; do not repoint them to this candidate.

Do not merge, publish or change tags until production compatibility and the release sequence are approved and this exact candidate is verified end to end. The narrow production release path remains unresolved. Publishing this Action is separate from deploying Precedent or releasing its assistant plugin.
