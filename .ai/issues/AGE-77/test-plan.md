# Test Plan

- Unit: extraction quality fixture creates typed candidates for decision, procedure, policy, lesson, and fact-like chunks.
- Unit: no-op indexed artifact with no actionable content produces a completed run with zero candidates.
- Unit: owner assignment uses source owner, then team/domain fallback, then default owner and reviewer.
- Unit: low-confidence candidate is opened as a blocked review changeset with a low-confidence check warning/failure.
- Unit: extracted atoms propagate ACL teams, roles, sensitivity, source ids, provenance tags, and source snippets.
- API: `POST /api/v1/candidate-extraction/run` extracts from processed artifacts and returns atoms, changesets, and run metadata.
- API: `GET /api/v1/candidate-extraction/status` exposes run/candidate state for the operator console.
- Integration: extracted candidate changeset can be reviewed with edited title/body through the existing memory changeset review route.

## Verification commands

- `npm test -- tests/candidate-extraction.test.ts`
- `npm test -- tests/candidate-extraction-api.test.ts`
- `npm run typecheck`
- `npm run ci`
