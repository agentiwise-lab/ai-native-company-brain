# Test Plan

## Tests

- `tests/artifact-processing.test.ts`
  - Short artifact moves through all stages and populates full-text/vector indexes.
  - Long artifact creates multiple offset-preserving chunks.
  - Unsupported format fails at parse with retryable failure state.
  - Sensitive data and prompt injection are classified on chunks.
  - Embedding failure records a safe failure reason.
  - Reprocessing replaces old chunks/index entries for the same artifact.

## Integration/build checks

- `npm test -- tests/artifact-processing.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
