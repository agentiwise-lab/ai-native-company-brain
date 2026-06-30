# AGE-96 Managed cloud tenant provisioning

## What to build

Build the hosted cloud control plane that provisions isolated tenants using the same core product contract as self-host. A customer should create a cloud tenant, get managed database/storage/queue/secrets, configure identity and Composio, and reach first connected source without operating infrastructure themselves.

## Acceptance criteria

- [ ] Cloud tenant provisioning creates tenant, admin, database/storage/queue/secrets configuration, and initial settings.
- [ ] Cloud and self-host use the same API, MCP, registry package, and data export formats.
- [ ] Tenant isolation and encryption boundaries are enforced and auditable.
- [ ] Provisioning flow includes Composio configuration handoff and setup diagnostics.
- [ ] Tests cover tenant creation, failed provision rollback, tenant isolation, secret rotation, and cloud-to-self-host export compatibility.

## Blocked by

- AGE-93
- AGE-95
