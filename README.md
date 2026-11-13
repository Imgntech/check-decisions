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

The repository needs the `.precedent.json` that the assistant's `setup_project` writes. The Action reads version 2 files, which `setup_project` writes now, and version 1 files from earlier releases:

| Project version | Checking Areas | Optional path mapping | Recording Area (ignored by the Action) |
| --- | --- | --- | --- |
| `2` | `checkAreaIds` | `{ "glob": "src/billing/**", "areaId": "<Area id>" }` | `recordAreaId` |
| `1` | `checkNodeIds` | `{ "glob": "src/billing/**", "nodeId": "<Area id>" }` | `recordNodeId` |

A version 1 file must list `checkNodeIds`; the older single `checkNodeId` is not read, so change it to `checkNodeIds: ["<Area id>"]` or run `setup_project` again. One to three checking Areas are checked. A changed file matching no glob is checked in the checking Areas. Version 1 of this Action reads only version 1 files, so pin `v2` before you commit a version 2 file.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Publishing

The public repository `Imgntech/check-decisions` holds a copy of this directory at its root. To release, copy `action.yml`, `index.mjs` and `README.md` there, and `tests/check-decisions-action.test.mjs` to its `tests/` folder with the import changed to `../index.mjs`. Commit, tag the release (for example `v2.0.1`) and move the major tag: `git tag -f v2 && git push -f origin v2`. Keep `v2` compatible with the `/api/w/{workspace}/pr-check` response; a breaking change gets `v3`. Never move a full version tag such as `v2.0.0`.
