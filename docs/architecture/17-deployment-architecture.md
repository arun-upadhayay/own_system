# 17 — Deployment Architecture

Constrained by a finding from the audit: **Docker, Docker Compose, PostgreSQL and Redis are all absent from the development machine** (`01-repository-audit.md` §3, AR-003). Docker remains the correct deployment target, but the architecture must not *require* it in order for a developer to run tests.

---

## 1. Environments

| Environment | Purpose | Database | Deploy trigger |
|---|---|---|---|
| **Local** | Development | Local or remote Postgres, by connection string | — |
| **Test / CI** | Automated verification | Ephemeral, per run | Every push |
| **Staging** | Pre-production verification | Dedicated, production-like, anonymized | Merge to `main` |
| **Production** | Live | Managed Postgres with replicas and PITR | Manual promotion from staging |

### 1.1 Local development without Docker

Because Docker is unavailable, the database is reached **by connection string alone**, making a locally installed, remote, or containerized Postgres interchangeable:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/controlplane      # local install
DATABASE_URL=postgresql://user:pass@dev-db.internal:5432/cp_arun     # shared dev
```

This is the practical consequence of the dependency inversion in HLD §3: domain and application logic test with no database at all, so a developer can make real progress on entitlement rules, limit resolution and state machines before Postgres is provisioned. Only repository-layer integration tests need a live database.

**Prerequisite to close before Phase 2 completes:** a reachable PostgreSQL 16+ with the `citext` extension available, plus Docker for the deployment work in §4. Until then, Phase 2's integration tests cannot be verified — recorded in AR-003 and carried into `19-implementation-plan.md`.

---

## 2. Runtime topology

```mermaid
graph TB
    subgraph EDGE["Edge"]
        LB["Load balancer<br/>TLS 1.3 termination"]
    end
    subgraph APP["Application tier — stateless"]
        W1["web · Next.js SSR"]
        W2["web · Next.js SSR"]
        A1["api · instance 1"]
        A2["api · instance 2"]
        WK["dispatcher<br/>single leader"]
    end
    subgraph DATA["Data"]
        PG[("Postgres primary")]
        RR[("read replica — when needed")]
    end
    subgraph EXT["External"]
        MAIL["Email"]
        OTEL["Telemetry"]
        KMS["Secret store / KMS"]
    end

    LB --> W1
    LB --> W2
    LB --> A1
    LB --> A2
    W1 --> A1
    W2 --> A2
    A1 --> PG
    A2 --> PG
    WK --> PG
    PG -.-> RR
    WK --> MAIL
    A1 --> OTEL
    A1 --> KMS

    style APP fill:#1e3a5f,stroke:#4a9eff,color:#fff
    style WK fill:#3d2f14,stroke:#d4a017,color:#fff
```

The API tier is stateless — sessions are in Postgres (ADR-008) — so scaling is adding instances and no sticky routing is required.

> **Correction (design review D-5).** This topology originally had no web tier. ADR-019 adds a Next.js rendering service, and omitting it from the deployment architecture would have meant discovering the gap during Phase 20.
>
> The web tier is **also stateless**: the session cookie is self-contained and tokens are verified by the API, so it scales identically and needs no sticky routing. It runs the **same image** with a different entrypoint, so there is one artifact to build, scan and version. Public discovery routes are cacheable at the edge; authenticated routes are not (`13` §1 requires `no-store` on authenticated responses).
>
> The load balancer routes `/api/v1/*` to the API and everything else to the web tier. The web tier's own `/api/*` route handlers are the thin session proxy (ADR-032), not business logic.

**The dispatcher is deliberately not horizontally scaled.** It holds a Postgres advisory lock as leader election; the others idle and take over if it dies. Three dispatchers would each deliver every event and send three copies of every email (`14` §3.2). It runs as the same image with a different entrypoint, so there is one artifact to build and version.

---

## 3. Configuration

All configuration is environment variables, validated at startup by a Zod schema. **The process refuses to start on invalid or missing configuration** — a server that boots with a missing secret and fails on first use fails at the worst possible moment, in front of a user, rather than at deploy time in front of an engineer.

```ts
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  ISSUER_URL: z.string().url(),
  JWK_ENCRYPTION_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(2592000),
  MAIL_PROVIDER_API_KEY: z.string(),
  MAIL_FROM: z.string().email(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  LOG_LEVEL: z.enum(['error','warn','info','debug']).default('info'),
})
```

Web tier (D-5):

```ts
const WebEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3001),
  API_INTERNAL_URL: z.string().url(),       // server-side only; never exposed
  SESSION_COOKIE_SECRET: z.string().min(32),
  NEXT_PUBLIC_ISSUER_URL: z.string().url(), // OIDC discovery for redirects
  NEXT_PUBLIC_ASSET_HOST: z.string().url(), // must match CSP img-src (`15` §7.1)
})
```

Only `NEXT_PUBLIC_*` values reach the browser. `API_INTERNAL_URL` and the cookie secret are server-side only — a mis-prefixed secret here would be published in the client bundle, so the schema's naming is a security boundary and is reviewed as one.

| Rule | Reason |
|---|---|
| No secret in the repository | `.env` gitignored; `.env.example` has names with empty values |
| No `NODE_ENV` branching in business logic | Environment-dependent behavior is untestable; differences belong in configuration values |
| Production secrets from the platform secret store | Never from a file on disk |
| **Limits are database rows, not environment variables** | ADR-010 — a limit in an env var is still a limit in deployment config, requiring a restart to change |

---

## 4. Containers

One image, two entrypoints. Multi-stage build; final stage is `node:24-alpine`, non-root, no build toolchain.

```dockerfile
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/
COPY apps/*/package.json ./apps/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node dist/healthcheck.js
CMD ["node", "dist/apps/api/server.js"]
```

`--frozen-lockfile` makes the build fail rather than silently resolve a different dependency tree — reproducibility is a supply-chain control (`15` §14). Running as non-root limits what a container escape reaches.

### 4.1 Compose for staging and local full-stack

```yaml
services:
  api:
    build: { context: ., target: runtime }
    environment:
      DATABASE_URL: postgresql://cp:cp@db:5432/controlplane
    depends_on: { db: { condition: service_healthy } }
    ports: ["3000:3000"]

  dispatcher:
    build: { context: ., target: runtime }
    command: ["node", "dist/apps/api/dispatcher.js"]
    depends_on: { db: { condition: service_healthy } }

  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: cp, POSTGRES_PASSWORD: cp, POSTGRES_DB: controlplane }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cp"]
      interval: 5s
    volumes: ["pgdata:/var/lib/postgresql/data"]

volumes: { pgdata: }
```

`service_healthy` rather than `service_started`: Postgres accepts connections only after initialization, and starting the API first produces a confusing crash loop that looks like an application bug.

Kubernetes is deferred (ADR-D4) — Compose suffices at current scale, and Docker is not yet installed.

---

## 5. Database migrations

Forward-only, sequential, reviewed SQL via Kysely migrations.

| Rule | Reason |
|---|---|
| Forward-only; no down migrations in production | A down migration that discards a column discards customer data. Recovery is a new forward migration plus a restore, which is slower but honest |
| One concern per migration | A failure is diagnosable |
| Run as a separate step, before the new version serves traffic | Not on application boot — concurrent boots would race |
| Backward-compatible for one release | Required by rolling deploys (§5.1) |
| Reviewed as carefully as code | A migration is the only change that can destroy data |

### 5.1 Expand / contract

During a rolling deploy, old and new application versions run simultaneously against one database. A migration that drops a column the old version still selects breaks it mid-request. So destructive changes take three releases:

```text
Release 1 — EXPAND:   add the new column, nullable; write both; read old
Release 2 — MIGRATE:  backfill; read new; keep writing both
Release 3 — CONTRACT: stop writing old; drop it
```

Slower, and the only approach that avoids downtime or data loss. Index creation on a populated table uses `CREATE INDEX CONCURRENTLY`, outside a transaction, since a plain `CREATE INDEX` takes a write lock and stalls the table.

### 5.2 Required first migrations

| Order | Migration | Why first |
|---|---|---|
| 0001 | `CREATE EXTENSION IF NOT EXISTS citext` | Tables depend on the type (review R-10) |
| 0002 | Roles: `app_role`, `maintenance_role` | Audit privileges depend on them (review R-13) |
| 0003 | Core identity tables | |
| … | Per `19-implementation-plan.md` | |
| last | RLS policies; `REVOKE UPDATE, DELETE ON audit_logs FROM app_role` | Applied after the tables exist |

---

## 6. CI/CD

```mermaid
graph LR
    P["Push / PR"] --> L["lint + typecheck"]
    L --> U["unit tests"]
    U --> I["integration tests<br/>ephemeral Postgres"]
    I --> S["security: audit, secrets, SAST"]
    S --> C["OpenAPI drift check"]
    C --> B["build image"]
    B --> ST["deploy staging"]
    ST --> E["E2E + OIDC conformance"]
    E --> M{"manual approval"}
    M --> PR["deploy production"]

    style M fill:#3d2f14,stroke:#d4a017,color:#fff
```

Gates that block a merge:

| Gate | Fails on |
|---|---|
| Typecheck | Any error; `strict` is non-negotiable |
| Lint | Errors, including the architecture rules — module boundaries, no hardcoded product slugs (ADR-013), no `dangerouslySetInnerHTML` |
| Unit tests | Any failure |
| Integration tests | Any failure, including tenant isolation and **concurrency** tests (ADR-011) |
| `pnpm audit` | High or critical vulnerability |
| Secret scan | Any detection |
| OpenAPI drift | Committed spec differs from generated — makes an undocumented endpoint a build failure (`13` §10) |

Production deployment is **manually promoted**, not automatic on merge. Early on, a human deciding when customer-facing change lands is worth more than deployment frequency.

---

## 7. Deploy and rollback

### 7.1 Rolling deploy

```text
1. Run migrations (backward-compatible)
2. Start new instances
3. Wait for /readyz
4. Shift traffic gradually
5. Drain and stop old instances
6. Dispatcher leadership transfers via the advisory lock
```

Graceful shutdown: stop accepting connections, finish in-flight requests (30s cap), close the pool, exit. Without it, a deploy kills requests mid-transaction and customers see errors from a successful deployment.

### 7.2 Rollback

| Scenario | Action |
|---|---|
| Application defect, schema unchanged | Redeploy the previous image — fast |
| Defect after a backward-compatible migration | Redeploy previous image; the migration is harmless |
| Defect after a destructive migration | **Forward fix only.** Restore from PITR if data is affected |

The expand/contract discipline (§5.1) exists so the third row is rare. It is also why down migrations are not used: a rollback that silently discards data is worse than a slower forward fix.

---

## 8. Backup and disaster recovery

| Aspect | Target |
|---|---|
| Backups | Automated daily full; continuous WAL archiving |
| PITR window | 7 days minimum |
| **RPO** | ≤ 5 minutes |
| **RTO** | ≤ 1 hour |
| Encryption | At rest and in transit |
| **Restore testing** | **Monthly, to a scratch environment** |

Restore testing is listed as a requirement rather than a nicety because an untested backup is a hope. The failure is discovered at the only moment it cannot be fixed.

Signing keys are backed up separately from the database (encrypted, in the secret store). A database restore without the matching keys cannot verify tokens issued before it, and the symptom — every session invalid after a restore — is obscure if the dependency was not planned for.

---

## 9. Scaling path

| Pressure | First response | Then |
|---|---|---|
| Request throughput | More API instances | Multiple regions |
| Read query load | Read replica for reporting | Partition by organization |
| Session lookup latency | Index tuning | Redis (ADR-008) |
| Rate-limit contention | — | Redis |
| Event volume | Dispatcher batch size | Broker fed by the outbox (ADR-009) |
| Audit table growth | Monthly range partitioning | Separate audit store |

Each is reachable without redesign, because each sits behind an interface. That is the whole scalability strategy — not building for scale now, but ensuring nothing must be unbuilt later.

---

## 10. Production readiness checklist

- [ ] Migrations run as a separate, reviewed step
- [ ] Secrets from the platform store; none in the repository
- [ ] Configuration validated at startup; invalid config refuses to boot
- [ ] TLS 1.3; HSTS preload; headers per `15` §7
- [ ] `/healthz` dependency-free; `/readyz` checks the database
- [ ] Graceful shutdown with request draining
- [ ] Dispatcher leader election verified under instance failure
- [ ] Backups automated; **restore tested**
- [ ] Signing keys backed up separately
- [ ] Alerts wired to a real channel with runbooks
- [ ] Rollback rehearsed
- [ ] Rate limits active on auth endpoints
- [ ] Non-root container; minimal image
- [ ] Load test covering concurrent seat grants (ADR-011)

---

Next: `18-admin-console-architecture.md`.
