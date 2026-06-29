# Test Plan

## Tests

- `tests/acl-enforcement.test.ts`
  - Protected memory is not returned to a reviewer without exec tier, and a deny event is emitted with policy context.
  - Allowed memory returns citations and an allow event.
  - A non-exec reviewer cannot approve an exec-protected changeset.
  - An employee cannot invoke a write-capable Composio/connector tool.

## Integration/build checks

- `npm test -- tests/acl-enforcement.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run ci`
