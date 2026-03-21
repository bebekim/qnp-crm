# qnp-crm

Nonprofit CRM CLI for [NanoClaw](https://github.com/qwibitai/nanoclaw). Manages contacts, donations, and DGR receipts for Australian nonprofits.

```
WhatsApp ──→ NanoClaw ──→ Claude Code (container) ──→ qnp-crm ──→ PostgreSQL
```

## Install

### As a NanoClaw skill

```bash
# From your NanoClaw installation, run:
/add-qnp-crm
```

This installs PostgreSQL, the `qnp-crm` binary, container extensions, and agent skill docs.

### Standalone

```bash
npm install -g qnp-crm
```

Requires PostgreSQL 16+ with `pg_trgm` extension.

## Commands

```bash
# Contacts
qnp-crm contacts add "Jane" "Smith" --email jane@example.org --type donor
qnp-crm contacts list --type donor
qnp-crm contacts search "Jane"
qnp-crm contacts show <id>

# Donations
qnp-crm donations add 500 --contact "Jane Smith" --method eft --fund general
qnp-crm donations list --from 2026-01-01
qnp-crm donations show <id>

# Receipts (DGR compliant)
qnp-crm receipts generate <donation-id>          # plan
qnp-crm receipts generate <donation-id> --confirm # execute
qnp-crm receipts batch --from 2026-01-01 --to 2026-03-31

# Reports
qnp-crm reports summary --from 2025-07-01 --to 2026-06-30
qnp-crm reports unreceipted
qnp-crm reports deadlines

# Config
qnp-crm config set org_name "My Nonprofit" --confirm
qnp-crm config show
```

## Three-Tier Confirmation

| Tier | Commands | Behaviour |
|------|----------|-----------|
| READ | list, show, search, report | Execute immediately |
| WRITE | add, edit, delete, import | Show plan, ask "Go ahead?" |
| RECEIPT | receipts generate/batch/void | Show full plan, require explicit YES |

## The Bright Line

Receipt and statement PDFs are **deterministic code only**. No LLM output may appear on a receipt. The `--confirm` flag enforces this structurally.

## Environment Variables

| Variable | Purpose | Fallback |
|----------|---------|----------|
| `QNP_DATABASE_URL` | PostgreSQL connection | `DATABASE_URL` |
| `QNP_DATA_DIR` | Receipt PDF storage | `NANOCLAW_DATA_DIR` |
| `QNP_PERFORMER` | Audit trail identity | `NANOCLAW_PERFORMER` |

## NanoClaw Skill Files

The `nanoclaw-skill/` directory contains files that get installed into a NanoClaw instance:

```
nanoclaw-skill/
├── container/
│   ├── Dockerfile.qnp-crm          # Container extension layer
│   └── skills/qnp-crm/SKILL.md     # Agent instructions
└── .claude/skills/
    └── add-qnp-crm/SKILL.md        # Installation skill
```

## Development

```bash
npm install
npm run build
npm test
npm run test:integration   # needs PostgreSQL
```

## License

ISC
