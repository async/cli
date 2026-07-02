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
- Do not add shell entrypoints, completions, trust prompts, or MCP mode in v1.
- Do not move or delete `../cli (1)/SPEC.md`; it is source material outside this
  package.

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
