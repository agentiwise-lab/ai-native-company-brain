# AGE-69 Normalize Composio outputs into source artifacts

Linear: https://linear.app/agentiwise/issue/AGE-69/normalize-composio-outputs-into-source-artifacts

## What to build

Create the reusable ingestion path that turns Composio action/session results into governed source artifacts. The slice should support a generic connector worker shape, source identity, provenance, ACL/sensitivity metadata, checkpointing, raw artifact storage, normalized text, and audit events.

## Acceptance criteria

- [ ] A Composio action result can be transformed into a persisted source artifact with raw and normalized representations.
- [ ] Artifact records include connector, source object ID, principal/account mapping, timestamps, provenance URL, ACL metadata, and sensitivity metadata.
- [ ] Worker checkpoints prevent duplicate artifacts and allow replay from a known point.
- [ ] Operator console can inspect artifact content, metadata, and sync history.
- [ ] Tests cover create, update, duplicate, failed transform, and revoked connected-account cases.

## Blocked by

- AGE-65
- AGE-68
