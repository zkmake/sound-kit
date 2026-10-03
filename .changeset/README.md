# Changesets

Every user-facing change ships with a changeset. Run `bun run changeset`, pick the bump, and
describe the change for the CHANGELOG. On `main`, the release workflow turns pending changesets into
a "Version Packages" PR. Merging that PR publishes to npm.
