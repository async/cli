# Changelog

## 0.1.2 - 2026-07-02

- Adds `cli --cp <command...> [--to root|local]` and `copyCommand()` for
  non-destructive command directory transfers between local and user-global
  command trees.

## 0.1.1 - 2026-07-02

- Pins generated workflows to the publish action that repairs scoped package
  public access before registry verification.
- Updates the Pipeline devDependency used to generate committed workflow files.
- Normalizes binary paths to match npm package metadata.

## 0.1.0 - 2026-07-02

- Initial package scaffold for `@async/cli`.
- Declares `cli` and `async-cli` binaries.
- Adds maintainer local-link scripts for checkout-backed binaries.
- Adds the accepted filesystem router v1 spec, package docs, build harness, and
  scaffold tests.
