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

`PRECEDENT_TOKEN` is a CI token from Settings, Agents in Precedent: read only, optionally limited to one Area, revocable there.

The repository needs the `.precedent.json` that the assistant's `setup_project` writes. Its checking and recording Areas are checked. An optional `paths` list maps globs to Areas; a changed file matching no glob is checked in the project's Areas.

Full setup, inputs and the endpoint it calls: `/docs/ci` on your Precedent deployment.

## Development

`index.mjs` is the whole Action: no dependencies and no build step. Its source of truth is `actions/check-decisions/` in the Precedent repository, with tests in `tests/check-decisions-action.test.mjs` and `tests/pr-check-db.test.ts`.

## Publishing

The public repository `Imgntech/check-decisions` holds a copy of this directory at its root. To release, copy `action.yml`, `index.mjs` and `README.md` there, commit, tag the release (`v1.2.0`) and move the major tag: `git tag -f v1 && git push -f origin v1`. Keep `v1` compatible with the `/api/w/{workspace}/pr-check` response; a breaking change gets `v2`.
