# AGE-71 - Composio-backed Google Drive and Gmail ingestion

## Linear

- URL: https://linear.app/agentiwise/issue/AGE-71/composio-backed-google-drive-and-gmail-ingestion
- Project: AI-Native Company Brain
- Status: In Progress
- Branch: harshit/all-linear-issues-buildout

## What to build

Deliver the Google knowledge-source integration through Composio. Admins should connect Google accounts, select Drive/Gmail scopes, sync docs and email threads into source artifacts, preserve available permissions/provenance, and make reviewed artifacts queryable by authorized users.

## Acceptance criteria

- Google connected accounts can be configured, tested, revoked, and reauthorized.
- Drive docs/sheets/slides and Gmail threads/labels can be backfilled and incrementally synced where supported.
- Artifacts preserve source URLs, authors, modified dates, thread/document structure, and available ACL/scope metadata.
- Reviewed Google-derived memory is queryable with citations and access restrictions.
- Tests cover large docs, attachments/unsupported formats, revoked account, missing scope, and duplicate sync handling.

## Blocked by

- AGE-69 - Normalize Composio outputs into source artifacts
