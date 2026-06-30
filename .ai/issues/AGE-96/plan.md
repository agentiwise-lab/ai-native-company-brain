# Implementation Plan

## Slice

Add a file-backed managed cloud control plane that provisions isolated tenant records, managed resource refs, Composio handoff state, setup diagnostics, access checks, secret rotation, and self-host-compatible exports.

## Design

- Persist cloud state in `data/cloud-control-plane-state.json` by default with env override.
- Provision tenant id, admin, region, plan, managed Postgres/storage/queue/secrets refs, encryption key ref, isolation prefixes, setup settings, Composio handoff, diagnostics, and first-source next action.
- Roll back partially provisioned tenants when a managed-resource provisioner fails and audit the rollback.
- Enforce tenant isolation by tenant-scoped admin scope or matching tenant admin, with audit events for access checks.
- Rotate secret refs per tenant and update managed resource config.
- Export a portable cloud-to-self-host bundle that uses the same `/api/v1`, `/api/mcp`, registry package format, and data export format as OSS/self-host.
- Add API routes for tenant create/list, secret rotation, export, and diagnostics.
- Add dashboard visibility for cloud tenants, isolation, diagnostics, exports, and rotations.

## Boundaries

- Cloud v1 records managed resource references and lifecycle decisions. It does not call a real cloud provider API from tests.
