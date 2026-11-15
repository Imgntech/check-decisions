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
      - uses: Imgntech/check-decisions@v3
        with:
          token: ${{ secrets.PRECEDENT_TOKEN }}
```

`PRECEDENT_TOKEN` is a CI token from Settings, Your preferences in Precedent: read only, optionally limited to one Area, revocable under Settings, Assistants.

Action v3 requires a version 2 `.precedent.json` using Area fields. The Action major and project schema version are different: keep `"version": 2` in the file.

| Project version | Checking Areas | Optional path mapping | Recording Area (ignored by the Action) |
| --- | --- | --- | --- |
| `2` | `checkAreaIds` | `{ "glob": "src/billing/**", "areaId": "<Area id>" }` | `recordAreaId` |

One to three checking Areas are checked. A changed file matching no glob is checked in the checking Areas.

### Migrate before upgrading

Stay on Action v2 while migrating: it accepts both config versions. Run `setup_project` to produce a version 2 file, preserving the intended checking Areas and every optional path mapping, or rename `checkNodeIds` to `checkAreaIds`, `recordNodeId` to `recordAreaId` and each `paths[].nodeId` to `paths[].areaId`. Preserve the IDs and globs. For an older single `checkNodeId`, use `checkAreaIds: ["<Area id>"]`. Remove the old keys, set `"version": 2`, and commit the configuration before switching the workflow to `@v3`.

Action v3 rejects version 1 files and obsolete Node config keys, including mixed old/new fields. Existing v1/v2 releases and tags remain unchanged. The HTTP endpoint still uses the `nodeIds` query parameter; this is an API field, not the project configuration format.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Publishing

The public repository `Imgntech/check-decisions` holds a copy of this directory at its root. To release, copy `action.yml`, `index.mjs` and `README.md` there, and `tests/check-decisions-action.test.mjs` to its `tests/` folder with the import changed to `../index.mjs`. After review and exact-head verification, publish the new `v3.0.0` tag and `v3` major alias. Preserve every existing v1/v2 tag and release. Never move an immutable full version tag; future compatible v3 releases may advance only the `v3` alias.
