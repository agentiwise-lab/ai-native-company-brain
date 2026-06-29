#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LINEAR_API = "https://api.linear.app/graphql";
const DEFAULT_TEAM = process.env.LINEAR_TEAM_NAME ?? "Agentiwise";
const DEFAULT_PROJECT = process.env.LINEAR_PROJECT_NAME ?? "AI-Native Company Brain";
const ISSUE_ROOT = ".ai/issues";

const command = process.argv[2];
const issueArg = process.argv[3];

function usage() {
  console.log(`Usage:
  npm run issue:pick -- [AGE-63]
  npm run issue:checkpoint -- AGE-63
  npm run issue:verify -- AGE-63
  npm run issue:finish -- AGE-63

Environment:
  LINEAR_API_KEY       Required for Linear read/write actions.
  LINEAR_TEAM_NAME     Defaults to "${DEFAULT_TEAM}".
  LINEAR_PROJECT_NAME  Defaults to "${DEFAULT_PROJECT}".
`);
}

function run(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${name} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function capture(name, args) {
  return execFileSync(name, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function ensureGitRepo() {
  try {
    capture("git", ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error("Not inside a git repository. Run git init and set up the GitHub remote first.");
  }
}

function currentBranch() {
  return capture("git", ["branch", "--show-current"]);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function issueDir(identifier) {
  return join(ISSUE_ROOT, identifier);
}

function writeIfMissing(path, content) {
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

function requireLinearKey() {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error("LINEAR_API_KEY is required for Linear issue loop commands.");
  }
  return key;
}

async function linearRequest(query, variables = {}) {
  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      Authorization: requireLinearKey(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors ?? payload, null, 2));
  }
  return payload.data;
}

const issueFields = `
  id
  identifier
  title
  description
  url
  branchName
  state { id name type }
  team { id name key }
  project { id name }
  projectMilestone { id name }
  priority
`;

async function getIssue(identifier) {
  const data = await linearRequest(
    `query Issue($id: String!) {
      issue(id: $id) { ${issueFields} }
    }`,
    { id: identifier }
  );
  return data.issue;
}

async function listProjectIssues() {
  const data = await linearRequest(
    `query ProjectIssues($team: String!, $project: String!) {
      issues(
        first: 100,
        filter: {
          team: { name: { eq: $team } },
          project: { name: { eq: $project } }
        }
      ) {
        nodes { ${issueFields} }
      }
    }`,
    { team: DEFAULT_TEAM, project: DEFAULT_PROJECT }
  );

  return data.issues.nodes;
}

function blockedByFromDescription(description = "") {
  const block = description.split(/## Blocked by/i)[1] ?? "";
  if (!block || /None\s*-\s*can start immediately/i.test(block)) {
    return [];
  }
  return [...new Set(block.match(/\b[A-Z]+-\d+\b/g) ?? [])];
}

function issueNumber(identifier) {
  return Number(identifier.split("-")[1] ?? 0);
}

async function findReadyIssue() {
  const issues = await listProjectIssues();
  const byId = new Map(issues.map((issue) => [issue.identifier, issue]));
  const candidates = issues
    .filter((issue) => !["completed", "canceled"].includes(issue.state.type))
    .sort((a, b) => issueNumber(a.identifier) - issueNumber(b.identifier));

  return candidates.find((issue) =>
    blockedByFromDescription(issue.description).every((identifier) => byId.get(identifier)?.state.type === "completed")
  );
}

async function getTeamStates(teamId) {
  const data = await linearRequest(
    `query TeamStates($id: String!) {
      team(id: $id) {
        states { nodes { id name type } }
      }
    }`,
    { id: teamId }
  );
  return data.team.states.nodes;
}

async function updateIssueState(issue, targetName) {
  const states = await getTeamStates(issue.team.id);
  const target = states.find((state) => state.name.toLowerCase() === targetName.toLowerCase());
  if (!target) {
    throw new Error(`Could not find Linear state "${targetName}" for team ${issue.team.name}.`);
  }

  await linearRequest(
    `mutation UpdateIssue($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue { identifier state { name type } }
      }
    }`,
    { id: issue.id, stateId: target.id }
  );
}

function issueArtifact(issue) {
  const blockers = blockedByFromDescription(issue.description);
  return `# ${issue.identifier}: ${issue.title}

URL: ${issue.url}
Project: ${issue.project?.name ?? DEFAULT_PROJECT}
Milestone: ${issue.projectMilestone?.name ?? "None"}
State: ${issue.state.name}
Blocked by: ${blockers.length === 0 ? "None" : blockers.join(", ")}

## Description

${issue.description ?? ""}
`;
}

function planTemplate(issue) {
  return `# Plan For ${issue.identifier}: ${issue.title}

## Goal

State the issue outcome in one paragraph.

## Scope

- In scope:
- Out of scope:

## Implementation Steps

1. 

## Files Expected To Change

- 

## Risks And Open Questions

- 

## Completion Evidence

- [ ] Acceptance criteria mapped to tests or manual verification.
- [ ] Tests fail before implementation where practical.
- [ ] \`npm run ci\` passes.
- [ ] Commit pushed to GitHub.
- [ ] Linear marked Done after push.
`;
}

function testPlanTemplate(issue) {
  return `# Test Plan For ${issue.identifier}: ${issue.title}

## Acceptance Criteria Coverage

Map each Linear acceptance criterion to at least one automated test or explicit manual verification.

| Criterion | Test or verification |
| --- | --- |
|  |  |

## TDD Notes

- First failing test:
- Expected failure:
- Implementation note:

## Commands

\`\`\`bash
npm run ci
\`\`\`
`;
}

function writeIssueFiles(issue) {
  const dir = issueDir(issue.identifier);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue.md"), issueArtifact(issue));
  writeIfMissing(join(dir, "plan.md"), planTemplate(issue));
  writeIfMissing(join(dir, "test-plan.md"), testPlanTemplate(issue));
  writeIfMissing(join(dir, "handoff.md"), `# Handoff For ${issue.identifier}

Use this file before any context reset.
`);
  writeFileSync(
    join(dir, "status.json"),
    JSON.stringify(
      {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: issue.state.name,
        branchName: issue.branchName,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function checkoutIssueBranch(issue) {
  ensureGitRepo();
  const branch = issue.branchName || `linear/${issue.identifier.toLowerCase()}-${slugify(issue.title)}`;
  const branches = capture("git", ["branch", "--list", branch]);
  if (branches.includes(branch)) {
    run("git", ["checkout", branch]);
  } else {
    run("git", ["checkout", "-b", branch]);
  }
}

function appendCheckpoint(identifier) {
  const dir = issueDir(identifier);
  mkdirSync(dir, { recursive: true });
  const handoffPath = join(dir, "handoff.md");
  const existing = existsSync(handoffPath) ? readFileSync(handoffPath, "utf8") : `# Handoff For ${identifier}\n`;
  const branch = (() => {
    try {
      return currentBranch();
    } catch {
      return "unknown";
    }
  })();
  const status = (() => {
    try {
      return capture("git", ["status", "--short"]);
    } catch {
      return "git unavailable";
    }
  })();

  writeFileSync(
    handoffPath,
    `${existing.trim()}

## Checkpoint ${new Date().toISOString()}

- Branch: ${branch}
- Git status:

\`\`\`
${status || "clean"}
\`\`\`
`
  );
}

function verify() {
  run("npm", ["run", "ci"]);
}

function hasGitChanges() {
  return capture("git", ["status", "--porcelain"]).length > 0;
}

function ensurePushedBranch(branch) {
  run("git", ["push", "-u", "origin", branch]);
}

async function pick() {
  const issue = issueArg ? await getIssue(issueArg) : await findReadyIssue();
  if (!issue) {
    throw new Error("No ready Linear issue found.");
  }

  writeIssueFiles(issue);
  checkoutIssueBranch(issue);
  if (issue.state.name.toLowerCase() === "todo" || issue.state.type === "unstarted") {
    await updateIssueState(issue, "In Progress");
  }
  appendCheckpoint(issue.identifier);
  console.log(`Picked ${issue.identifier}: ${issue.title}`);
}

async function finish() {
  if (!issueArg) {
    throw new Error("issue:finish requires an issue identifier, for example AGE-63.");
  }

  ensureGitRepo();
  const issue = await getIssue(issueArg);
  const branch = currentBranch();
  if (!branch || branch === "main" || branch === "master") {
    throw new Error(`Refusing to finish ${issue.identifier} from protected branch "${branch}".`);
  }

  verify();
  appendCheckpoint(issue.identifier);

  if (!hasGitChanges()) {
    throw new Error("No local changes to commit. Refusing to mark Linear Done without a pushed commit.");
  }

  run("git", ["add", "."]);
  run("git", ["commit", "-m", `${issue.identifier}: ${issue.title}`]);
  ensurePushedBranch(branch);
  await updateIssueState(issue, "Done");
  console.log(`Finished ${issue.identifier}: pushed ${branch} and marked Done.`);
}

async function main() {
  if (!command || command === "help") {
    usage();
    return;
  }

  if (command === "pick") {
    await pick();
    return;
  }

  if (command === "checkpoint") {
    if (!issueArg) {
      throw new Error("issue:checkpoint requires an issue identifier.");
    }
    appendCheckpoint(issueArg);
    return;
  }

  if (command === "verify") {
    verify();
    if (issueArg) {
      appendCheckpoint(issueArg);
    }
    return;
  }

  if (command === "finish") {
    await finish();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

