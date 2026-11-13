import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionError, CHECK_AREA_LIMIT, REF_LIMIT, areasFor, deploymentUrl, extractRefs, globToRegExp, marker, md, parseProject, readInputs, renderComment, run,
} from "../index.mjs";

const WS = "11111111-1111-4111-8111-111111111111";
const CHECK = "22222222-2222-4222-8222-222222222222";
const BILLING = "33333333-3333-4333-8333-333333333333";
const RECORD = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const project = (extra = {}) => JSON.stringify({ version: 2, deployment: "https://precedent.example", workspaceId: WS, recordAreaId: RECORD, checkAreaIds: [CHECK], ...extra });
const url = (ref) => `https://precedent.example/w/acme/decisions/${ref}`;

test("inputs default fail-on to both facts and reject unknown kinds", () => {
  assert.deepEqual(readInputs({ "INPUT_FAIL-ON": "expired-exception,superseded-ref" }).failOn, ["expired-exception", "superseded-ref"]);
  assert.deepEqual(readInputs({ "INPUT_FAIL-ON": "" }).failOn, []);
  assert.throws(() => readInputs({ "INPUT_FAIL-ON": "expired-exception, similar" }), (e) => e instanceof ActionError && /got similar/.test(e.message));
});

test("the project link needs a workspace and 1 to 3 checking Areas, and paths map globs to Areas", () => {
  assert.throws(() => parseProject("{"), /not valid JSON/);
  assert.throws(() => parseProject(project({ checkAreaIds: [] })), /needs checkAreaIds/);
  assert.throws(() => parseProject(project({ checkAreaIds: CHECK })), /needs checkAreaIds/);
  assert.throws(() => parseProject(project({ checkAreaIds: ["not-a-uuid"] })), /needs checkAreaIds/);
  assert.throws(() => parseProject(project({ checkAreaIds: [CHECK, CHECK.toUpperCase()] })), /needs checkAreaIds/);
  assert.equal(CHECK_AREA_LIMIT, 3);
  assert.throws(() => parseProject(project({ checkAreaIds: [CHECK, BILLING, RECORD, OTHER] })), /at most 3/);
  assert.deepEqual(parseProject(project({ checkAreaIds: [CHECK.toUpperCase(), BILLING, OTHER] })).checkAreaIds, [CHECK, BILLING, OTHER]);
  // The recording Area is the assistant's; the check neither needs nor reads it.
  const noRecord = JSON.parse(project());
  delete noRecord.recordAreaId;
  assert.deepEqual(parseProject(JSON.stringify(noRecord)).checkAreaIds, [CHECK]);
  assert.equal("recordAreaId" in parseProject(project()), false);
  assert.throws(() => parseProject(project({ paths: [{ glob: "src/**" }] })), /paths must be a list/);
  assert.throws(() => parseProject(project({ paths: [{ glob: "src/**", nodeId: BILLING }] })), /paths must be a list of \{ "glob": "src\/billing\/\*\*", "areaId"/);
  assert.deepEqual(parseProject(project({ paths: [{ glob: " billing/** ", areaId: BILLING.toUpperCase() }] })).paths, [{ glob: "billing/**", areaId: BILLING }]);
});

test("a version 1 project link is refused with a message to set the project up again", () => {
  const versionOne = JSON.stringify({ version: 1, deployment: "https://precedent.example", workspaceId: WS, recordNodeId: RECORD, checkNodeIds: [CHECK] });
  assert.throws(() => parseProject(versionOne), (e) => e instanceof ActionError && /version 1 project link, and version 1 files are no longer read\. Set the project up again: ask your assistant to run setup_project/.test(e.message));
  assert.throws(() => parseProject(project({ version: 3 })), (e) => e instanceof ActionError && /must be a version 2 project link/.test(e.message));
  // A version 2 file with the old field names is incomplete, not read under the new ones.
  assert.throws(() => parseProject(JSON.stringify({ version: 2, workspaceId: WS, recordNodeId: RECORD, checkNodeIds: [CHECK] })), /needs checkAreaIds/);
});

test("globs: ** crosses directories, * stays in one, a bare name matches at any depth", () => {
  assert.ok(globToRegExp("services/billing/**").test("services/billing/a/b.ts"));
  assert.ok(globToRegExp("services/**/*.sql").test("services/x.sql"));
  assert.ok(globToRegExp("services/**/*.sql").test("services/a/b/x.sql"));
  assert.ok(!globToRegExp("services/*.ts").test("services/a/b.ts"));
  assert.ok(globToRegExp("*.tf").test("infra/prod/main.tf"));
  assert.ok(globToRegExp("docs/").test("docs/a.md"));
  assert.ok(!globToRegExp("src/a.ts").test("src/aXts"));
});

test("without paths the checking Areas are checked, never the recording Area; with paths each file counts toward its Areas or the checking ones", () => {
  assert.deepEqual(areasFor(["anything.ts"], parseProject(project())), [CHECK]);
  const several = parseProject(project({ checkAreaIds: [CHECK, OTHER] }));
  assert.deepEqual(areasFor(["anything.ts"], several), [CHECK, OTHER]);
  const mapped = parseProject(project({ checkAreaIds: [CHECK, OTHER], paths: [{ glob: "billing/**", areaId: BILLING }] }));
  assert.deepEqual(areasFor(["billing/charge.ts"], mapped), [BILLING]);
  assert.deepEqual(areasFor(["billing/charge.ts", "README.md"], mapped).sort(), [BILLING, CHECK, OTHER].sort());
  assert.deepEqual(areasFor([], mapped), [CHECK, OTHER]);
});

test("the token only goes to https, or plain http on this machine", () => {
  assert.equal(deploymentUrl("https://precedent.example/", ".precedent.json"), "https://precedent.example");
  assert.equal(deploymentUrl("http://localhost:3000", ".precedent.json"), "http://localhost:3000");
  assert.throws(() => deploymentUrl("http://precedent.example", ".precedent.json"), /must use https/);
  assert.throws(() => deploymentUrl("", ".precedent.json"), /Set the url input/);
});

test("refs are read from any ref-shaped text, upper-cased and unique, and a cut is counted", () => {
  assert.deepEqual(extractRefs(["Follows AR-041 and ar-041", "Fixes PRE-77\n\nSee (AR-090).", null]), { refs: ["AR-041", "PRE-77", "AR-090"], skipped: 0 });
  assert.deepEqual(extractRefs(["1AR-041 AR-041x"]).refs, []);
  assert.deepEqual(extractRefs(["see-AR-041"]).refs, ["AR-041"], "as the server reads a prompt");
  const many = extractRefs([Array.from({ length: REF_LIMIT + 3 }, (_, i) => `AR-${i + 1}`).join(" ")]);
  assert.equal(many.refs.length, REF_LIMIT);
  assert.equal(many.skipped, 3);
});

test("titles cannot inject Markdown, HTML or mentions", () => {
  assert.equal(md("Use [x](http://evil) <img> | @octocat"), "Use \\[x\\](http://evil) \\<img\\> \\| @​octocat");
});

const result = (changes = {}) => ({
  workspace: { id: WS, slug: "acme" },
  areas: [{ id: CHECK, name: "Inspection" }],
  decisions: [
    { ref: "AR-120", title: "Keep raw images for 30 days", url: url("AR-120"), type: "Exception", state: "expired", badge: "Expired", expiresAt: "2026-10-01" },
    { ref: "AR-121", title: "Skip the second camera", url: url("AR-121"), type: "Exception", state: "decided", badge: "Expiring", expiresAt: "2026-11-05" },
    { ref: "AR-041", title: "Use Postgres search", url: url("AR-041"), type: null, state: "decided", badge: null, expiresAt: null },
  ],
  omittedDecisions: 0,
  cited: [],
  failures: [{ kind: "expired-exception", ref: "AR-120", title: "Keep raw images for 30 days", reason: "Exception AR-120 expired: it stood through 2026-10-01.", url: url("AR-120"), successor: null }],
  warnings: [],
  omittedWarnings: 0,
  ...changes,
});

test("the comment starts with its marker, names the failure and badges, and says what fails", () => {
  const body = renderComment(result(), { failOn: ["expired-exception", "superseded-ref"], config: ".precedent.json", deployment: "https://precedent.example" });
  assert.ok(body.startsWith(marker(".precedent.json")));
  assert.match(body, /### Precedent: 1 recorded fact fails this check/);
  assert.match(body, /\*\*Expired exception\*\* \[AR-120\]\(https:\/\/precedent\.example\/w\/acme\/decisions\/AR-120\).*\(fails the check\)/);
  assert.match(body, /\| \[AR-121\]\(.*\) \| Skip the second camera \| Exception \| \*\*Expiring\*\* 2026-11-05 \|/);
  const lenient = renderComment(result(), { failOn: ["superseded-ref"], config: ".precedent.json", deployment: "https://precedent.example" });
  assert.match(lenient, /no recorded fact fails this check/);
  assert.match(lenient, /not failing: expired-exception is not in fail-on/);
});

/** A fake Precedent and GitHub. `check` is what the pull request check returns; comments persist across runs. */
function world({ check = result(), checkStatus = 200, comments = [], prBody = "Ships the cleanup job.", login = null } = {}) {
  const calls = [];
  const state = { comments };
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  async function fetchImpl(input, init = {}) {
    const u = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ method, url: u, init });
    if (u.pathname.endsWith("/pr-check")) {
      if (init.headers?.Authorization !== "Bearer ci-token") return json(401, { error: "unauthorized", message: "The token is invalid, expired or revoked." });
      return json(checkStatus, typeof check === "function" ? check(u) : check);
    }
    // The workflow's own token cannot read /user; a personal token can.
    if (u.pathname === "/user") return login ? json(200, { login }) : json(403, { message: "Resource not accessible by integration" });
    if (u.pathname === "/repos/acme/robots/pulls/7") return json(200, { number: 7, title: "Image cleanup", body: prBody });
    if (u.pathname === "/repos/acme/robots/pulls/7/commits") return json(200, [{ commit: { message: "Clean images per AR-041" } }]);
    if (u.pathname === "/repos/acme/robots/pulls/7/files") return json(200, [{ filename: "billing/charge.ts" }]);
    if (u.pathname === "/repos/acme/robots/issues/7/comments" && method === "GET") return json(200, state.comments);
    if (u.pathname === "/repos/acme/robots/issues/7/comments" && method === "POST") {
      const c = { id: state.comments.length + 1, body: JSON.parse(init.body).body, user: { login: login ?? "github-actions[bot]", type: login ? "User" : "Bot" } };
      state.comments.push(c);
      return json(201, c);
    }
    const edit = /^\/repos\/acme\/robots\/issues\/comments\/(\d+)$/.exec(u.pathname);
    if (edit && method === "PATCH") {
      const c = state.comments.find((x) => x.id === Number(edit[1]));
      c.body = JSON.parse(init.body).body;
      return json(200, c);
    }
    return json(404, { message: "Not Found" });
  }
  const env = (extra = {}) => ({
    INPUT_TOKEN: "ci-token",
    "INPUT_FAIL-ON": "expired-exception,superseded-ref",
    INPUT_CONFIG: ".precedent.json",
    INPUT_COMMENT: "true",
    "INPUT_GITHUB-TOKEN": "gh-token",
    GITHUB_EVENT_PATH: "/event.json",
    GITHUB_REPOSITORY: "acme/robots",
    GITHUB_API_URL: "https://api.github.example",
    ...extra,
  });
  return { calls, state, fetchImpl, env };
}

const files = (text = project()) => (p) => {
  if (p === "/event.json") return JSON.stringify({ number: 7, pull_request: { number: 7 } });
  if (p === ".precedent.json") return text;
  throw new Error("ENOENT");
};
const quiet = async (fn) => {
  const write = process.stdout.write;
  const out = [];
  process.stdout.write = (s) => (out.push(String(s)), true);
  try {
    return { value: await fn(), out: out.join("") };
  } finally {
    process.stdout.write = write;
  }
};

test("a run checks the Areas and refs, comments once, and fails on an expired exception", async () => {
  const w = world();
  const { value, out } = await quiet(() => run({ env: w.env(), fetchImpl: w.fetchImpl, readFile: files() }));
  assert.equal(value.failed, true);
  const check = w.calls.find((c) => c.url?.pathname.endsWith("/pr-check")).url;
  assert.equal(check.origin, "https://precedent.example");
  assert.equal(check.pathname, `/api/w/${WS}/pr-check`);
  assert.equal(check.searchParams.get("nodeIds"), CHECK);
  assert.equal(check.searchParams.get("refs"), "AR-041");
  assert.equal(w.state.comments.length, 1);
  assert.match(out, /::add-mask::ci-token/);
  assert.match(out, /::error title=Expired exception AR-120::AR-120 Keep raw images/);
});

test("a comment someone else wrote with the marker is left alone", async () => {
  const planted = { id: 1, body: `${marker(".precedent.json")}\nAll clear`, user: { login: "mallory", type: "User" } };
  const w = world({ comments: [planted] });
  await quiet(() => run({ env: w.env(), fetchImpl: w.fetchImpl, readFile: files() }));
  assert.equal(planted.body, `${marker(".precedent.json")}\nAll clear`);
  assert.equal(w.state.comments.length, 2);
  // With a personal token, the comment is matched by its author instead.
  const own = world({ login: "acme-ci", comments: [{ id: 1, body: `${marker(".precedent.json")}\nold`, user: { login: "acme-ci", type: "User" } }] });
  await quiet(() => run({ env: own.env(), fetchImpl: own.fetchImpl, readFile: files() }));
  assert.equal(own.state.comments.length, 1);
  assert.match(own.state.comments[0].body, /recorded fact fails/);
});

test("a rerun after the exception is reaffirmed passes and updates the same comment", async () => {
  const w = world();
  await quiet(() => run({ env: w.env(), fetchImpl: w.fetchImpl, readFile: files() }));
  const reaffirmed = result({ failures: [], decisions: [{ ...result().decisions[0], state: "decided", badge: null, expiresAt: "2027-04-01" }] });
  const again = world({ check: reaffirmed, comments: w.state.comments });
  const { value } = await quiet(() => run({ env: again.env(), fetchImpl: again.fetchImpl, readFile: files() }));
  assert.equal(value.failed, false);
  assert.equal(again.state.comments.length, 1, "no duplicate comment");
  assert.match(again.state.comments[0].body, /no recorded fact fails this check/);
  assert.ok(again.calls.some((c) => c.method === "PATCH"));
});

test("a superseded ref in the body fails with its successor; a current ref passes with the citation", async () => {
  const successor = { ref: "AR-090", title: "Use Postgres search", url: url("AR-090") };
  const superseded = result({
    decisions: [],
    failures: [{ kind: "superseded-ref", ref: "AR-041", title: "Use Elasticsearch", reason: "AR-041 was superseded by AR-090; cite AR-090 instead.", url: url("AR-041"), successor }],
    cited: [{ ref: "AR-041", title: "Use Elasticsearch", url: url("AR-041"), type: null, state: "superseded", badge: null, expiresAt: null, successor }],
  });
  const w = world({ check: superseded, prBody: "Implements AR-041." });
  const first = await quiet(() => run({ env: w.env(), fetchImpl: w.fetchImpl, readFile: files() }));
  assert.equal(first.value.failed, true);
  assert.match(w.state.comments[0].body, /Follow \[AR-090\]/);

  const current = result({ decisions: [], failures: [], cited: [{ ...successor, type: null, state: "decided", badge: null, expiresAt: null, successor: null }] });
  const ok = world({ check: current, prBody: "Implements AR-090." });
  const second = await quiet(() => run({ env: ok.env(), fetchImpl: ok.fetchImpl, readFile: files() }));
  assert.equal(second.value.failed, false);
  assert.match(ok.state.comments[0].body, /#### Cited in this pull request\n- \[AR-090\]\(.*\) Use Postgres search: decided/);
});

test("paths send the touched Areas", async () => {
  const w = world();
  await quiet(() => run({ env: w.env(), fetchImpl: w.fetchImpl, readFile: files(project({ paths: [{ glob: "billing/**", areaId: BILLING }] })) }));
  assert.equal(w.calls.find((c) => c.url?.pathname.endsWith("/pr-check")).url.searchParams.get("nodeIds"), BILLING);
});

test("a missing, rejected or foreign token fails with a clear message, not a stack trace", async () => {
  const w = world();
  await assert.rejects(
    quiet(() => run({ env: w.env({ INPUT_TOKEN: "stale" }), fetchImpl: w.fetchImpl, readFile: files() })),
    (e) => e instanceof ActionError && e.message === "Precedent rejected the token: The token is invalid, expired or revoked.",
  );
  const foreign = world({ checkStatus: 403, check: { error: "forbidden", message: "This token belongs to the beta workspace, not acme." } });
  await assert.rejects(
    quiet(() => run({ env: foreign.env(), fetchImpl: foreign.fetchImpl, readFile: files() })),
    (e) => e instanceof ActionError && /refused the check: This token belongs to the beta workspace/.test(e.message),
  );
  const none = world();
  await assert.rejects(run({ env: none.env({ INPUT_TOKEN: "" }), fetchImpl: none.fetchImpl, readFile: files() }), /Set the token input .* forks do not receive repository secrets/);
});

test("a token for another workspace than .precedent.json names is refused", async () => {
  const w = world({ check: result({ workspace: { id: "99999999-9999-4999-8999-999999999999", slug: "beta" } }) });
  await assert.rejects(quiet(() => run({ env: w.env(), fetchImpl: w.fetchImpl, readFile: files() })), /names workspace .* but the token belongs to beta/);
});

test("reference extraction and comments preserve refs beyond three digits", () => {
  const refs = ["AR-999", "AR-1000", "AR-1001", "AR-10000"];
  assert.deepEqual(extractRefs(["See AR-999, ar-1000 and `AR-1001`. Next: AR-10000."]).refs, refs);
  const body = renderComment(result({ cited: refs.map(ref => ({ ref, title: "Catalog search", url: url(ref), state: "decided", type: null, badge: null, expiresAt: null, successor: null })) }), { failOn: [], config: ".precedent.json", deployment: "https://precedent.example" });
  for (const ref of refs) assert.ok(body.includes(`[${ref}](${url(ref)})`), body);
});
