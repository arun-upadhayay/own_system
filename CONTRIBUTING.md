# Contributing

## Branching and commits

- `main` is protected. Work happens on `feat/*`, `fix/*`, `docs/*`, `chore/*`.
- Commits follow Conventional Commits: `type(scope): subject`.
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
  Scopes are packages or domains: `api`, `web`, `ui`, `core`, `identity`, `rbac`.

## Before you push

```bash
pnpm verify        # typecheck → lint → architecture guards → contrast → tests
pnpm test:e2e      # requires a build
```

## Architecture is enforced, not suggested

These fail the build, not review:

| Guard | What it stops |
|---|---|
| `cp/no-hardcoded-products` | Product slugs in code (ADR-013) |
| `no-restricted-imports` | Deep imports across packages (HLD §4.1) |
| `scripts/check-contrast.mjs` | WCAG AA regressions in design tokens |
| `scripts/verify-lint-rules.mjs` | The guards above silently not firing |
| axe tests | Accessibility regressions, both themes |

Read `docs/architecture/` before changing behaviour, and `docs/design/` before
changing UI. An architectural change is recorded as an ADR in
`docs/architecture/21-architecture-decisions.md` (or `docs/design/12-ui-decisions.md`
for frontend) plus an entry in `docs/architecture/22-change-log.md`. Never change a
documented decision silently.

## Phase discipline

Work follows `docs/architecture/19-implementation-plan.md`. A phase is complete only
when its acceptance criteria pass with evidence.
