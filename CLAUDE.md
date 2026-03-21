# CRM Tools — Developer Knowledge

## What is this?
`qnp-crm` is a single-binary CLI with subcommands for managing nonprofit contacts, donations, and DGR receipts.
It runs inside a NanoClaw container. Claude Code calls it via bash.

## The Bright Line
**Receipt and statement PDFs are deterministic code only. No LLM in the causal chain.**
- `receipts generate` and `statements generate` produce PDFs via template functions
- Receipt numbers come from a PostgreSQL sequence (NO CACHE, NO CYCLE)
- PDF content is never generated, suggested, or modified by any AI system
- Every receipt gets a SHA-256 hash stored in the database for tamper detection

## The --confirm Pattern
All WRITE and RECEIPT tier commands support `--confirm`:
- **Without --confirm**: command validates inputs and outputs a `plan` object describing what would happen
- **With --confirm**: command executes the action
- Claude Code calls without --confirm first, shows the user the plan, then re-runs with --confirm

This is how the bright line is enforced structurally. The SKILL.md in the container
teaches Claude Code the tier rules, but the CLI enforces them in code.

## Adding a New Command

1. Create `crm/src/{domain}/{action}.ts`
2. Export an async function that takes typed params and returns `CommandResult<T>`
3. Use `ok()`, `fail()`, or `needsConfirm()` helpers from `types.ts`
4. Always call `audit()` for mutations
5. Wire it into `cli.ts` under the appropriate subcommand
6. Add the command to `container/skills/qnp-crm/SKILL.md`

## Key Rules
- All money: `DECIMAL(12,2)`, never `float`. Use string in TypeScript.
- Australian financial year: July 1 – June 30
- Use "suburb" not "city"
- States: VIC, NSW, QLD, SA, WA, TAS, NT, ACT
- Receipt numbers: sequential, gap-free, never reused, never reset
- Audit log: append-only, never pruned, every mutation
- Output JSON by default (Claude Code parses it). Table only for TTY admin use.
- UUID primary keys, show first 8 chars in output for readability

## Database
- PostgreSQL with pg_trgm extension (for fuzzy search)
- Drizzle ORM for schema and queries
- Schema in `src/db/schema.ts` — single source of truth
- Connection via `QNP_DATABASE_URL` env var (falls back to `DATABASE_URL`)
- Receipt number sequence: `qnp_receipt_seq`

## Environment Variables
| Variable | Purpose | Fallback |
|----------|---------|----------|
| `QNP_DATABASE_URL` | PostgreSQL connection | `DATABASE_URL` |
| `QNP_DATA_DIR` | Receipt PDF storage | `NANOCLAW_DATA_DIR` |
| `QNP_PERFORMER` | Audit trail identity | `NANOCLAW_PERFORMER` |

## Testing
```bash
cd crm
npm test                          # vitest unit tests
npm run test:integration          # integration tests (needs PG)
qnp-crm contacts list            # quick smoke test
qnp-crm contacts add "Test" "User" --email test@test.org  # outputs plan (no --confirm)
```
