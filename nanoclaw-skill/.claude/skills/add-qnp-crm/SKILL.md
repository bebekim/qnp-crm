# Add qnp-crm

Adds nonprofit CRM tools (contacts, donations, DGR receipts) to your NanoClaw installation.
Installs `qnp-crm` — a single CLI binary with subcommands for all CRM operations.

## What This Does

### Phase 1: Install PostgreSQL
```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16

# Linux (Ubuntu/Debian)
sudo apt-get install -y postgresql-16 postgresql-16-pgtrgm
sudo systemctl enable --now postgresql
```

### Phase 2: Create database
```bash
sudo -u postgres psql -c "CREATE USER nanoclaw WITH PASSWORD 'nanoclaw';"
sudo -u postgres psql -c "CREATE DATABASE nanoclaw OWNER nanoclaw;"
sudo -u postgres psql -d nanoclaw -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
sudo -u postgres psql -d nanoclaw -c "CREATE SEQUENCE IF NOT EXISTS qnp_receipt_seq INCREMENT BY 1 NO CACHE NO CYCLE START WITH 1;"
sudo -u postgres psql -d nanoclaw -c "GRANT USAGE ON SEQUENCE qnp_receipt_seq TO nanoclaw;"
```

### Phase 3: Install qnp-crm
```bash
npm install -g qnp-crm
```

### Phase 4: Install NanoClaw skill files
Fetch and copy skill files from the qnp-crm repo:
```bash
# Dockerfile extension
curl -fsSL https://raw.githubusercontent.com/bebekim/qnp-crm/main/nanoclaw-skill/container/Dockerfile.qnp-crm \
  -o container/Dockerfile.qnp-crm

# Agent skill doc (teaches container agent how to use qnp-crm)
mkdir -p container/skills/qnp-crm
curl -fsSL https://raw.githubusercontent.com/bebekim/qnp-crm/main/nanoclaw-skill/container/skills/qnp-crm/SKILL.md \
  -o container/skills/qnp-crm/SKILL.md
```

### Phase 5: Configure environment
Add to `.env` or the NanoClaw environment:
```
QNP_DATABASE_URL=postgres://nanoclaw:nanoclaw@host.docker.internal:5432/nanoclaw
QNP_DATA_DIR=/var/lib/nanoclaw
```

Push schema to database:
```bash
qnp-crm db push
```

### Phase 6: Configure organisation
Ask the user for their details, then run:
```bash
qnp-crm config set org_name "Their Org Name" --confirm
qnp-crm config set dgr_name "Their DGR Name" --confirm
qnp-crm config set abn "12345678901" --confirm
qnp-crm config set address "123 Main St, Melbourne VIC 3000" --confirm
qnp-crm config set receipt_prefix "RC-" --confirm
```

### Phase 7: Verify and rebuild
```bash
qnp-crm config show
qnp-crm contacts add "Test" "User" --email test@example.org --type other --confirm
qnp-crm contacts list
./container/build.sh
```

## Prerequisites

- PostgreSQL 16+ installed and running
- Node.js 22+

## Target Users

Small Australian nonprofits (under 5 staff) who:
- Currently use Salesforce (Power of Us) and want to migrate off
- Use spreadsheets and want to upgrade
- Need DGR-compliant receipt generation
- Want a WhatsApp-first CRM interface
