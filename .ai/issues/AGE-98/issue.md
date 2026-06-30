# AGE-98: Private/public plugin marketplace

## What to build

Build the marketplace path for governed skills, tools, plugins, policies, and connector packs. Enterprises should publish private packages internally, optionally install public/community packages, review provenance and security results, and keep the same package format across self-host and cloud.

## Acceptance criteria

- Marketplace lists private and public packages with owner, version, compatibility, eval results, security status, install count, and changelog.
- Installing a package opens a local registry changeset instead of auto-publishing it.
- Package trust, signature/provenance, dependency, and permission data are visible before install.
- Cloud and self-host package exports/imports remain compatible.
- Tests cover private package install, public package review, unsafe package block, dependency install, and rollback after marketplace install.

## Blocked by

- AGE-85: Done
- AGE-96: Done
