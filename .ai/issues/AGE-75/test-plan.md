# Test Plan

## Tests

- `tests/connector-ops.test.ts`
  - Health dashboard includes connected account status, checkpoint, lag, latest run, and recent errors.
  - Replay from an existing artifact is idempotent and returns duplicate when nothing changed.
  - Revoked account blocks replay and tool execution path.
  - Checkpoint persistence survives replay and remains visible.
  - Failed runs expose safe retry guidance and failure context.

## Integration/build checks

- `npm test -- tests/connector-ops.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
