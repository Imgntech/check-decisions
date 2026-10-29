// PRE-77: the check-decisions GitHub Action. One file with no dependencies, so it runs as published
// without a build step. It reads .precedent.json, works out which Areas the pull request touches,
// asks Precedent's pull request check about them and the refs the pull request names, posts or
// updates a single comment, and fails only on the facts listed in fail-on.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FAIL_KINDS = ["expired-exception", "superseded-ref"];
/** GitHub lists at most this many commits for a pull request. */
export const COMMIT_LIMIT = 250;
const WORKFLOW_BOT = "github-actions[bot]";
/** Refs sent per check, read in order from the title, body and commits. Matches REF_LIMIT in src/lib/agent-warnings.ts. */
export const REF_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error the user can act on. Its message is printed as is, without a stack trace. */
export class ActionError extends Error {}

/** Inputs as the runner passes them: INPUT_<NAME> with the name upper-cased. */
export function readInputs(env = process.env) {
  const get = (name) => (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  const failOn = get("fail-on")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = failOn.filter((k) => !FAIL_KINDS.includes(k));
  if (unknown.length) throw new ActionError(`fail-on accepts ${FAIL_KINDS.join(" and ")}; got ${unknown.join(", ")}.`);
  return {
    token: get("token"),
    url: get("url"),
    config: get("config") || ".precedent.json",
    failOn,
    comment: get("comment") !== "false",
    githubToken: get("github-token"),
  };
}

/** The project link the assistant saved, with the optional `paths` mapping. */
export function parseProject(text, path = ".precedent.json") {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    throw new ActionError(`${path} is not valid JSON.`);
  }
  if (!p || p.version !== 1) throw new ActionError(`${path} must be a version 1 project link. Run setup_project from your assistant to create one.`);
  for (const key of ["workspaceId", "recordNodeId", "checkNodeId"]) if (typeof p[key] !== "string" || !UUID.test(p[key])) throw new ActionError(`${path} needs ${key}, an id from setup_project.`);
  const paths = p.paths ?? [];
  if (!Array.isArray(paths) || paths.some((m) => !m || typeof m.glob !== "string" || !m.glob.trim() || typeof m.nodeId !== "string" || !UUID.test(m.nodeId))) {
    throw new ActionError(`${path} paths must be a list of { "glob": "src/billing/**", "nodeId": "<Area id>" }.`);
  }
  return { deployment: typeof p.deployment === "string" ? p.deployment : "", workspaceId: p.workspaceId.toLowerCase(), recordNodeId: p.recordNodeId.toLowerCase(), checkNodeId: p.checkNodeId.toLowerCase(), paths: paths.map((m) => ({ glob: m.glob.trim(), nodeId: m.nodeId.toLowerCase() })) };
}

/** `**` crosses directories, `*` and `?` stay within one; a glob without a slash matches a file name at any depth. */
export function globToRegExp(glob) {
  let g = glob.replace(/^\.\//, "").replace(/^\//, "");
  if (!g.includes("/")) g = `**/${g}`;
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      const slash = g[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * The Areas a change touches. Without a mapping, the project's checking and recording Areas, as an
 * assistant using the project link checks them. With one, each changed file counts toward every Area
 * whose glob it matches, and a file that matches none toward the project's Areas.
 */
export function areasFor(files, project) {
  const own = [...new Set([project.checkNodeId, project.recordNodeId])];
  if (!project.paths.length) return own;
  const maps = project.paths.map((m) => ({ re: globToRegExp(m.glob), nodeId: m.nodeId }));
  const ids = new Set();
  for (const f of files) {
    const hits = maps.filter((m) => m.re.test(f));
    for (const id of hits.length ? hits.map((h) => h.nodeId) : own) ids.add(id);
  }
  return ids.size ? [...ids] : own;
}

/** Anything shaped like a decision ref, such as AR-041. Precedent keeps those with the workspace's prefix. */
export function extractRefs(texts) {
  const out = new Set();
  // The same boundaries as the server's promptRefs: not inside a longer word or number.
  for (const t of texts) for (const m of (t ?? "").matchAll(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]{0,11}-\d{1,7}(?![A-Za-z0-9])/g)) out.add(m[0].toUpperCase());
  const all = [...out];
  return { refs: all.slice(0, REF_LIMIT), skipped: Math.max(0, all.length - REF_LIMIT) };
}

/** The facts that fail this run, given fail-on. */
export const failing = (result, failOn) => result.failures.filter((f) => failOn.includes(f.kind));

// ---------------------------------------------------------------------------
// The comment
// ---------------------------------------------------------------------------

export const marker = (config) => `<!-- precedent:check-decisions ${config.replace(/-->/g, "")} -->`;

/** Plain text for a Markdown line: a title cannot add Markdown, a table cell, HTML or a mention. GitHub still autolinks a bare URL. */
export const md = (s) => String(s ?? "").replace(/[\\`*_[\]<>|#~]/g, "\\$&").replace(/@/g, "@\u200b").replace(/\s+/g, " ").trim();
const link = (d) => `[${md(d.ref)}](${d.url})`;

export function renderComment(result, { failOn, config, deployment, skippedRefs = 0, commitsCut = false }) {
  const fails = failing(result, failOn);
  const lines = [marker(config)];
  lines.push(fails.length ? `### Precedent: ${fails.length} recorded ${fails.length === 1 ? "fact fails" : "facts fail"} this check` : "### Precedent: no recorded fact fails this check");
  lines.push("", `Checked ${result.areas.length === 1 ? "Area" : "Areas"}: ${result.areas.map((a) => md(a.name)).join(", ")}.`);

  if (result.failures.length) {
    lines.push("", "#### Problems");
    for (const f of result.failures) {
      const counted = failOn.includes(f.kind) ? "fails the check" : `not failing: ${f.kind} is not in fail-on`;
      lines.push(`- **${f.kind === "expired-exception" ? "Expired exception" : "Superseded ref"}** ${link(f)} ${md(f.title)}. ${md(f.reason)}${f.successor ? ` Follow ${link(f.successor)} ${md(f.successor.title)}.` : ""} (${counted})`);
    }
  }

  if (skippedRefs) lines.push("", `The pull request mentions more than ${REF_LIMIT} ref-like strings; the last ${skippedRefs} were not checked.`);
  if (commitsCut) lines.push("", `GitHub lists only the first ${COMMIT_LIMIT} commits; refs in later commits were not checked.`);

  if (result.cited.length) {
    lines.push("", "#### Cited in this pull request");
    for (const d of result.cited) lines.push(`- ${link(d)} ${md(d.title)}: ${state(d)}${d.successor ? `, superseded by ${link(d.successor)}` : ""}`);
  }

  lines.push("", "#### Decisions that apply");
  if (!result.decisions.length) lines.push("No decided decisions are tagged with the checked Areas.");
  else {
    lines.push("", "| Ref | Decision | Type | State |", "| --- | --- | --- | --- |");
    for (const d of result.decisions) lines.push(`| ${link(d)} | ${md(d.title)} | ${md(d.type ?? "")} | ${state(d)} |`);
    if (result.omittedDecisions) lines.push("", `And ${result.omittedDecisions} more in Precedent.`);
  }

  if (result.warnings.length) {
    lines.push("", "#### Also worth knowing");
    for (const w of result.warnings) lines.push(`- ${link(w)} ${md(w.title)}. ${md(w.reason)}`);
    if (result.omittedWarnings) lines.push(`- And ${result.omittedWarnings} more.`);
  }

  lines.push(
    "",
    `<sub>Recorded facts from ${md(deployment)}, never search matches. Fails on: ${failOn.length ? failOn.join(", ") : "nothing (comment only)"}. To clear an expired exception, its owner reaffirms it with a new date or records a replacement, then rerun this check.</sub>`,
  );
  return lines.join("\n");
}

function state(d) {
  if (d.badge === "Expired" || d.state === "expired") return `**Expired** ${d.expiresAt ? `(through ${d.expiresAt})` : ""}`.trim();
  if (d.badge === "Expiring") return `**Expiring** ${d.expiresAt ?? ""}`.trim();
  return md(d.state);
}

// ---------------------------------------------------------------------------
// Precedent
// ---------------------------------------------------------------------------

async function call(fetchImpl, url, init, what) {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ActionError(`Could not reach Precedent for ${what} at ${new URL(url).origin}: ${err?.cause?.code ?? err?.message ?? err}.`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: a proxy page or an outage. Reported by status below.
  }
  return { res, body };
}

export async function runCheck({ base, workspace, token, nodeIds, refs }, fetchImpl = fetch) {
  const q = new URLSearchParams();
  if (nodeIds.length) q.set("nodeIds", nodeIds.join(","));
  if (refs.length) q.set("refs", refs.join(","));
  const { res, body } = await call(fetchImpl, `${base}/api/w/${encodeURIComponent(workspace)}/pr-check?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "the pull request check");
  if (res.ok && body) return body;
  const message = body?.message ?? `HTTP ${res.status}`;
  if (res.status === 401) throw new ActionError(`Precedent rejected the token: ${message}`);
  if (res.status === 403) throw new ActionError(`Precedent refused the check: ${message}`);
  if (res.status === 404) throw new ActionError(`Precedent could not find it: ${message}. Check checkNodeId and paths in .precedent.json against list_nodes.`);
  throw new ActionError(`The pull request check failed (HTTP ${res.status}): ${message}`);
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export function github({ token, apiUrl = "https://api.github.com", repo }, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "precedent-check-decisions" };
  async function request(method, path, body) {
    const res = await fetchImpl(path.startsWith("http") ? path : `${apiUrl}${path}`, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const hint = res.status === 403 || res.status === 404 ? " Give the workflow pull-requests: write and contents: read permissions." : "";
      throw new ActionError(`GitHub ${method} ${path.replace(apiUrl, "")} failed with HTTP ${res.status}.${hint} ${detail.slice(0, 200)}`.trim());
    }
    return { res, data: res.status === 204 ? null : await res.json() };
  }
  async function all(path, max) {
    const out = [];
    let next = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (next && out.length < max) {
      const { res, data } = await request("GET", next);
      out.push(...data);
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
    }
    return out;
  }
  const base = `/repos/${repo}`;
  return {
    pull: (n) => request("GET", `${base}/pulls/${n}`).then((r) => r.data),
    // GitHub lists at most 3000 files and 250 commits for a pull request.
    files: (n) => all(`${base}/pulls/${n}/files`, 3000).then((fs) => fs.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean))),
    commits: (n) => all(`${base}/pulls/${n}/commits`, COMMIT_LIMIT).then((cs) => cs.map((c) => c.commit?.message ?? "")),
    /**
     * Updates this config's comment in place, or posts it. Only a comment this token wrote counts, so a
     * person who pastes the marker cannot have the report written into a comment they can edit.
     */
    async upsertComment(n, body, mark) {
      const comments = await all(`${base}/issues/${n}/comments`, 3000);
      // A personal token can name its user; the workflow's own token cannot, and writes as github-actions[bot].
      const login = (await request("GET", "/user").then((r) => r.data?.login, () => null)) ?? WORKFLOW_BOT;
      const ours = (c) => c.user?.login === login;
      const mine = comments.find((c) => typeof c.body === "string" && c.body.startsWith(mark) && ours(c));
      if (mine) return (await request("PATCH", `${base}/issues/comments/${mine.id}`, { body })).data;
      return (await request("POST", `${base}/issues/${n}/comments`, { body })).data;
    },
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const command = (name, message, props = "") => process.stdout.write(`::${name}${props}::${String(message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}\n`);

function setOutput(env, name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/** Where the token goes. Plain http only to this machine, so a token never crosses a network in clear. */
export function deploymentUrl(raw, config) {
  const base = raw.replace(/\/+$/, "");
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new ActionError(`Set the url input, or a deployment in ${config}.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new ActionError(`The Precedent deployment must use https: ${base}.`);
  return base;
}

export async function run({ env = process.env, fetchImpl = fetch, readFile = (p) => readFileSync(p, "utf8") } = {}) {
  const inputs = readInputs(env);
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFile(env.GITHUB_EVENT_PATH)) : {};
  const number = event.pull_request?.number ?? event.number;
  if (!number) throw new ActionError("Run this action on pull_request or pull_request_target events.");
  if (!inputs.token) throw new ActionError("Set the token input to a CI token from Settings, Agents in Precedent. Pull requests from forks do not receive repository secrets.");
  command("add-mask", inputs.token);
  const repo = env.GITHUB_REPOSITORY;

  let text;
  try {
    text = readFile(inputs.config);
  } catch {
    throw new ActionError(`${inputs.config} not found. Run setup_project from your assistant and commit the file, or set the config input.`);
  }
  const project = parseProject(text, inputs.config);
  const base = deploymentUrl(inputs.url || project.deployment, inputs.config);

  const gh = github({ token: inputs.githubToken, apiUrl: env.GITHUB_API_URL || undefined, repo }, fetchImpl);
  const [pull, files, commits] = await Promise.all([gh.pull(number), project.paths.length ? gh.files(number) : Promise.resolve([]), gh.commits(number)]);
  const nodeIds = areasFor(files, project);
  const { refs, skipped } = extractRefs([pull.title, pull.body, ...commits]);
  if (skipped) command("warning", `Checked the first ${REF_LIMIT} ref-like strings in the pull request; ${skipped} more were not checked.`);
  const commitsCut = commits.length >= COMMIT_LIMIT;
  if (commitsCut) command("warning", `GitHub lists only the first ${COMMIT_LIMIT} commits; refs in later commits were not checked.`);

  const result = await runCheck({ base, workspace: project.workspaceId, token: inputs.token, nodeIds, refs }, fetchImpl);
  if (result.workspace?.id !== project.workspaceId) throw new ActionError(`${inputs.config} names workspace ${project.workspaceId}, but the token belongs to ${result.workspace?.slug ?? "another workspace"}.`);

  const body = renderComment(result, { failOn: inputs.failOn, config: inputs.config, deployment: base, skippedRefs: skipped, commitsCut });
  if (inputs.comment) await gh.upsertComment(number, body, marker(inputs.config));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${body}\n`);
  const fails = failing(result, inputs.failOn);
  setOutput(env, "failures", fails.length);
  setOutput(env, "decisions", result.decisions.length + (result.omittedDecisions ?? 0));
  for (const f of fails) command("error", `${f.ref} ${f.title}: ${f.reason}`, ` title=${f.kind === "expired-exception" ? "Expired exception" : "Superseded ref"} ${f.ref}`);
  return { failed: fails.length > 0, result, body };
}

async function main() {
  try {
    const { failed } = await run();
    if (failed) process.exitCode = 1;
  } catch (err) {
    command("error", err instanceof ActionError ? err.message : `Unexpected error: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
