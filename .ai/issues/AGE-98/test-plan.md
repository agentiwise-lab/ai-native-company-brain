# Test Plan

- Focused unit/service tests for private and public marketplace listings.
- Install tests proving private/public installs create local changesets instead of publishing.
- Trust review tests proving signature, provenance, dependency, permission, compatibility, eval, and security data are visible before install.
- Unsafe install tests proving blocked security/signature/permission packages do not create changesets.
- Dependency install tests proving missing public dependencies are staged with the requested package.
- Rollback tests proving marketplace installs can create audited rollback changesets.
- Route tests for marketplace status, listing, install, review, rollback, and export compatibility.
- Full `npm run ci` before commit/push.
