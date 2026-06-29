# Linear Issue Execution Loop

This project uses Linear as the implementation queue and GitHub as the durable code/history surface.

## Setup

Required local environment:

```bash
export LINEAR_API_KEY=...
gh auth status
npm ci
```

The Linear project is `AI-Native Company Brain` in the `Agentiwise` team.

## Pick

Pick a specific issue:

```bash
npm run issue:pick -- AGE-63
```

Or let the script choose the first Todo issue whose `Blocked by` section is empty or completed:

```bash
npm run issue:pick
```

This writes:

- `.ai/issues/<issue>/issue.md`
- `.ai/issues/<issue>/plan.md`
- `.ai/issues/<issue>/test-plan.md`
- `.ai/issues/<issue>/handoff.md`
- `.ai/issues/<issue>/status.json`

It also creates or switches to a branch named from the Linear branch suggestion when available.

## Plan And Tests

Before editing product code, update:

- `.ai/issues/<issue>/plan.md`
- `.ai/issues/<issue>/test-plan.md`

The plan should map the acceptance criteria to implementation steps. The test plan should name the failing tests that prove the change before implementation.

This is the durable replacement for chat memory. If the chat needs to be cleared, the agent must run:

```bash
npm run issue:checkpoint -- <issue>
```

After the reset, reload the files above and continue.

## TDD

For each acceptance criterion:

1. Add or update a test that fails for the expected reason.
2. Implement the smallest product change.
3. Run the narrow test command.
4. Repeat until every criterion has direct test evidence or an explicitly documented manual verification.

## Verify

Run the full local gate:

```bash
npm run issue:verify -- <issue>
```

This runs:

```bash
npm run ci
```

`npm run ci` runs typecheck, unit tests, and production build.

## Finish

Only after verification passes:

```bash
npm run issue:finish -- <issue>
```

The finish command:

1. Runs the full verification gate.
2. Commits current changes with the Linear issue in the commit subject.
3. Pushes the current branch.
4. Marks the Linear issue Done.

If any step fails, the Linear issue stays open.

