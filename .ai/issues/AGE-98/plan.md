# Plan

1. Add a marketplace domain service over registry import and package distribution primitives.
2. Model listings from both private registry items and public package manifests with trust, provenance, security, dependencies, permissions, evals, compatibility, changelog, and install counts.
3. Make install open local draft/review changesets, including dependency changesets, without publishing packages.
4. Block unsafe package installs before changeset creation and audit the denial.
5. Support marketplace rollback by opening an audited rollback changeset after a marketplace install.
6. Add API routes and a dashboard panel for marketplace listing, review, install, rollback, and state.
7. Verify with focused marketplace tests, full CI, commit, push, remote CI, then mark Linear done.
