# @async/cli Repository Guide

This repo owns the `@async/cli` package: a Node 24+ filesystem command router
that runs directory-backed project and user-global commands.

## Working Rules

- Use Node 24+, pnpm, ESM, TypeScript source under `src/`, and explicit `.js`
  import extensions.
- Keep runtime dependencies at zero unless a future ADR explicitly approves one.
- Preserve command directories as the move unit.
- Keep `script` valid as a command segment; only `script.{ts,mts,js,mjs}` files
  make a command directory runnable.
- v0.3 ships filesystem-root discovery, completions, the overlay trust model,
  `--edit`/`--rm`, templates, the `cli-cwd` pragma, `--doctor`, machine-readable
  listing, and command packs; keep their contracts aligned with `SPEC.md`.
- Command discovery never consults `.git`; only the `--agents` context-file
  subsystem, including its doctor audit, uses the Git repository boundary.
- Do not add a persistent or time-based command-path cache. Resolution must
  observe the live filesystem on every invocation.
- Do not add non-JavaScript entrypoints (`.sh`, `.py`) or a hosted pack
  registry.
- Do not move or delete `../cli (1)/SPEC.md`; it is source material outside this
  package.

## Generated Artifacts And Pipeline

- `@async/pipeline` (pinned in `devDependencies`) generates this repo's CI,
  Pages, preview, and release automation from `pipeline.ts`.
- Do not hand-edit `.github/workflows/async-pipeline.yml`, the locks under
  `.locks/pipeline/`, or the generated `pipeline:*` scripts in `package.json`.
  Change `pipeline.ts`, then run:

```bash
pnpm run pipeline:sync:generate
pnpm run pipeline:sync:check
pnpm run pipeline:github:check
```

- Releases of `@async/pipeline` dispatch `async-dep-bump` to this repo; the
  generated `dependency-bump` job applies the bump, regenerates synced
  surfaces, runs `release:check`, and pushes to `main` or opens a pull
  request on failure. Manual pipeline version bumps should follow the same
  steps: bump, regenerate, verify.

## Verification

Run the package gate before handoff:

```bash
pnpm run release:check
```

For a narrower loop:

```bash
pnpm run build
pnpm test
```
