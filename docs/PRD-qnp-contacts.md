# PRD: qnp-crm contacts

## Overview

Contact and organisation management commands within the `qnp-crm` CLI. Replaces Salesforce Contact, Account, and relationship objects for nonprofit operations. Runs inside a NanoClaw container — Claude Code calls commands via bash, parses JSON output, and formats WhatsApp-friendly replies.

Part of the unified `qnp-crm` CLI. Not a standalone binary.

## CLI Design Principles

These principles apply to all `qnp-crm` commands. They exist because LLM agents consume CLIs more efficiently than protocol-based tool systems (MCP). A lean skill file (~200 tokens) teaches the agent what commands exist; `--help` provides just-in-time detail. No schema pre-loading, no background processes, no protocol overhead.

| Principle | Implementation |
|---|---|
| **JSON to stdout** | All command output is structured JSON (`CommandResult<T>`). Claude Code parses it and formats for WhatsApp. `--format table` for admin TTY use. |
| **Just-in-time discovery via `--help`** | Every subcommand has `--help`. Claude Code calls `qnp-crm contacts --help` then `qnp-crm contacts search --help` for flags. No front-loaded schema. |
| **`--confirm` on all mutations** | Every WRITE or RECEIPT tier command requires `--confirm` to execute. Without it, the command outputs a `plan` object showing what would happen. Claude Code shows the plan, waits for user approval, then re-runs with `--confirm`. |
| **Three-tier confirmation** | READ: execute immediately. WRITE: plan → user "Go ahead?" → execute. RECEIPT: plan → user "YES" (explicit) → execute. Tier is a property of each command, enforced in CLI code. |
| **Meaningful exit codes** | 0 = success, 1 = user error (bad input, not found), 2 = system error (DB down). |
| **No interactive prompts** | Claude Code runs in a container. No stdin. All confirmation flows through the `--confirm` flag pattern. |
| **Composable via Claude Code** | Claude Code chains commands by parsing JSON output and passing values to subsequent calls. No Unix pipes needed — the LLM is the glue. |
| **Idempotent where possible** | Import with `--on-duplicate skip` skips existing records. Merge is safe to retry. |

## CommandResult Shape

Every command returns this JSON structure:

```typescript
{
  ok: boolean;
  data: T;                    // payload (contact, array, null)
  count: number;              // row count
  plan?: {                    // present on WRITE/RECEIPT without --confirm
    action: string;           // human description
    details: Record<string, unknown>;
    tier: "read" | "write" | "receipt";
    confirmCommand: string;   // exact command to re-run
  };
  warnings: string[];         // problems that didn't prevent success
  hints: string[];            // proactive follow-up suggestions for Claude Code
}
```

Claude Code reads `hints` and proactively offers follow-up actions to the user.

## Salesforce Features Replaced

| Salesforce Feature | qnp-crm Equivalent | Notes |
|---|---|---|
| Contact object | `contacts add/edit/show/search/list` | Full CRUD with tagging |
| Account object | `orgs add/show/list` | "Org" instead of "Account" |
| Contact-Account relationship | `contacts link` | Contact ↔ Org many-to-many with role |
| Contact tags/topics | `--tag` on contacts and orgs | Freeform key=value tags, no picklist admin |
| List Views | `contacts list` with filters | Query-based, not saved views |
| Data Import Wizard | `contacts import` | CSV with auto-detection and field mapping |
| Reports (contact) | `contacts list` + Claude Code | Agent summarises results |
| NPSP Affiliations | `contacts link` with `--role` | Contact ↔ Org with role |
| NPSP Household Account | Not replicated | Use org with type "household" if needed |

### Excluded Salesforce Features (with rationale)

| Feature | Why Excluded |
|---|---|
| Account hierarchy | Nonprofits rarely use nested account trees. Flat org list with tagging covers real usage. |
| Sharing rules / OWD | Single-tenant appliance. No per-record visibility needed. |
| Record types | Tags and contactType field cover this without admin overhead. |
| Page layouts | No UI — agent formats for WhatsApp. |
| Territory management | Not relevant to nonprofit operations. |
| NPSP Contact-Contact relationships | Can be added later via tags or a relationship table. Not in v1 scope. |

## Data Model

### contacts table

```
id              UUID PK (defaultRandom)
first_name      VARCHAR(100) NOT NULL
last_name       VARCHAR(100) NOT NULL
email           VARCHAR(254)                -- unique partial index WHERE email IS NOT NULL
phone           VARCHAR(20)
address_line1   VARCHAR(200)
address_line2   VARCHAR(200)
suburb          VARCHAR(100)                -- Australian: "suburb" not "city"
state           VARCHAR(3)                  -- VIC, NSW, QLD, SA, WA, TAS, NT, ACT
postcode        VARCHAR(4)                  -- 4-digit Australian
contact_type    VARCHAR(20) NOT NULL DEFAULT 'other'   -- donor, volunteer, client, board, other
notes           TEXT
merged_into     UUID                        -- soft delete via merge reference
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

Indexes:
- `contacts_email_uniq` — unique partial index on `email` WHERE `email IS NOT NULL`
- `contacts_name_idx` — on (`last_name`, `first_name`)

### organisations table

```
id              UUID PK (defaultRandom)
name            VARCHAR(200) NOT NULL
org_type        VARCHAR(30) NOT NULL DEFAULT 'other'   -- charity, corporate, government, school
abn             VARCHAR(11)                 -- unique partial WHERE abn IS NOT NULL
address_line1   VARCHAR(200)
address_line2   VARCHAR(200)
suburb          VARCHAR(100)
state           VARCHAR(3)
postcode        VARCHAR(4)
phone           VARCHAR(20)
website         VARCHAR(500)
notes           TEXT
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

### contact_org_links table

```
id              UUID PK (defaultRandom)
contact_id      UUID NOT NULL → contacts.id (CASCADE)
org_id          UUID NOT NULL → organisations.id (CASCADE)
role            VARCHAR(100)
is_primary      BOOLEAN NOT NULL DEFAULT false
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

Constraint: `contact_org_uniq` unique on (`contact_id`, `org_id`)

### tags table (polymorphic)

```
id              UUID PK (defaultRandom)
entity_type     VARCHAR(10) NOT NULL        -- 'contact' or 'org'
entity_id       UUID NOT NULL
key             VARCHAR(50) NOT NULL
value           VARCHAR(200)                -- optional: key-only or key=value
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

Constraints:
- `tags_entity_key_uniq` unique on (`entity_type`, `entity_id`, `key`)
- `tags_entity_idx` index on (`entity_type`, `entity_id`)

### audit_log table

```
id              BIGSERIAL PK
table_name      VARCHAR(50) NOT NULL
record_id       UUID NOT NULL
action          VARCHAR(10) NOT NULL        -- INSERT, UPDATE, DELETE
changed_fields  JSONB                       -- {field: {old, new}} for UPDATEs
performed_by    VARCHAR(100) NOT NULL       -- "cli:agent" or "cli:admin"
performed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

Append-only. Never pruned. Every mutation logged.

## Commands

### `qnp-crm contacts add <firstName> <lastName>` — WRITE tier

Create a new contact.

```bash
qnp-crm contacts add "Jane" "Smith" \
  --email jane@example.org \
  --phone "0412 345 678" \
  --address-line1 "123 Main St" \
  --suburb "Melbourne" \
  --state VIC \
  --postcode 3000 \
  --type donor \
  --tag vip \
  --tag source=gala2026 \
  --notes "Met at 2025 gala"
```

**Without --confirm** — outputs plan:
```json
{
  "ok": true, "data": null, "count": 0,
  "plan": {
    "action": "Add contact: Jane Smith",
    "details": {"name": "Jane Smith", "email": "jane@example.org", "type": "donor", "tags": "vip, source=gala2026"},
    "tier": "write",
    "confirmCommand": "qnp-crm contacts add \"Jane\" \"Smith\" --email \"jane@example.org\" --type donor --tag \"vip\" --tag \"source=gala2026\" --confirm"
  }
}
```

**With --confirm** — executes, returns contact row.

**Acceptance Criteria:**
- AC1: `firstName` and `lastName` both required (positional args)
- AC2: Email validated (format check). Duplicate email → hard fail with existing contact details
- AC3: Phone stored as-is (no normalisation in v1)
- AC4: Tags created on-the-fly. Format: `key` or `key=value`. Repeatable `--tag` flag
- AC5: `--type` defaults to `other`. Freeform but suggested: donor, volunteer, client, board, other
- AC6: Returns `ContactRow` (id truncated to 8 chars, name, email, type, tags)
- AC7: Hint generated if no email: "No email on file — you'll need one before generating DGR receipts."
- AC8: Audit log entry on INSERT

### `qnp-crm contacts list` — READ tier

List contacts with filters.

```bash
qnp-crm contacts list --type donor --tag vip
qnp-crm contacts list --state VIC --search "Smith"
qnp-crm contacts list --sort -createdAt --limit 10
```

**Acceptance Criteria:**
- AC1: Filters: `--type`, `--tag` (AND logic, repeatable), `--search` (ILIKE on name/email/notes), `--state`
- AC2: Excludes merged contacts (`merged_into IS NULL`)
- AC3: Pagination: `--limit` (default 50), `--offset` (default 0)
- AC4: Sort: `--sort <field>` (default `lastName`). Prefix `-` for descending
- AC5: Fetches N+1 rows to detect "has more" — hint with next offset
- AC6: Tags fetched and joined per contact in result
- AC7: Returns `ContactRow[]`

### `qnp-crm contacts search <query>` — READ tier

Fuzzy search contacts and organisations using `pg_trgm` similarity.

```bash
qnp-crm contacts search "Jane"
qnp-crm contacts search "Jane" --type contact
qnp-crm contacts search "Our Village" --type org
```

**Acceptance Criteria:**
- AC1: Searches contacts (first+last name, email, phone) and organisations (name) by default
- AC2: `--type` filter: `contact`, `org`, or `all` (default `all`)
- AC3: Uses PostgreSQL `similarity()` function with threshold 0.3
- AC4: Falls back to ILIKE `%query%` for substring matches below similarity threshold
- AC5: Results sorted by similarity score descending
- AC6: Returns `SearchResult[]` with `{id, type, name, email, score}`
- AC7: `--limit` (default 20)

### `qnp-crm contacts show <id>` — READ tier

Display full contact details with related data.

```bash
qnp-crm contacts show abc12345
qnp-crm contacts show jane@example.org
```

**Acceptance Criteria:**
- AC1: Accepts UUID (or 8-char prefix) or email as identifier
- AC2: Returns full `Contact` with all fields
- AC3: Includes tags, linked orgs (with roles), and donation summary (count + total) if donations table exists
- AC4: 404 error if not found
- AC5: If email matches multiple (shouldn't due to unique index), returns first match

### `qnp-crm contacts edit <id>` — WRITE tier

Update contact fields. Only specified fields are changed.

```bash
qnp-crm contacts edit abc12345 --phone "0499 111 222"
qnp-crm contacts edit abc12345 --tag board-member --confirm
```

**Without --confirm** — outputs plan showing field changes (old → new).

**Acceptance Criteria:**
- AC1: Partial update — unspecified fields unchanged
- AC2: `--tag` adds to existing tags (does not replace)
- AC3: `--remove-tag <key>` removes a specific tag
- AC4: Plan shows old and new values for changed fields
- AC5: Audit log entry with `changed_fields` JSON on UPDATE
- AC6: Updates `updated_at` timestamp

### `qnp-crm contacts delete <id>` — WRITE tier

Delete a contact.

```bash
qnp-crm contacts delete abc12345 --confirm
```

**Acceptance Criteria:**
- AC1: Sets `merged_into` to a sentinel value (effectively soft-deletes)
- AC2: Warns if contact has linked donations (shows count + total)
- AC3: Does NOT cascade-delete donations — donations retain the contact_id for audit trail
- AC4: Audit log entry on DELETE

### `qnp-crm contacts import <file>` — WRITE tier

Import contacts from CSV.

```bash
qnp-crm contacts import donors.csv
qnp-crm contacts import donors.csv --on-duplicate skip --tag imported-2026 --confirm
qnp-crm contacts import salesforce-export.csv --dry-run
```

**Without --confirm** — validates file and reports what would happen (counts, errors, duplicates).

**Acceptance Criteria:**
- AC1: Auto-detects common column names: first_name/firstName/First Name, last_name/lastName/Last Name, email/Email, phone/Phone
- AC2: `--on-duplicate skip` skips rows where email already exists. `--on-duplicate update` merges fields
- AC3: `--tag` applies tag to all imported contacts
- AC4: `--dry-run` validates without inserting (even if `--confirm` is set)
- AC5: Reports: created count, skipped count, error details per row
- AC6: Handles Salesforce Contact export CSV format
- AC7: Progress: warnings for rows with missing required fields (lastName)

### `qnp-crm contacts export` — READ tier

Export contacts to CSV or JSON.

```bash
qnp-crm contacts export --type donor -o donors.csv
qnp-crm contacts export --format json > contacts.json
```

**Acceptance Criteria:**
- AC1: Same filters as `contacts list`
- AC2: CSV output includes: firstName, lastName, email, phone, address fields, type, tags (comma-separated)
- AC3: JSON output matches `Contact` type
- AC4: `-o` writes to file; without it, writes to stdout

### `qnp-crm contacts dedup` — READ tier

Find potential duplicate contacts.

```bash
qnp-crm contacts dedup
```

**Acceptance Criteria:**
- AC1: Groups contacts by exact email match
- AC2: Groups contacts by fuzzy name match (similarity > 0.7)
- AC3: Returns duplicate groups with scores and suggested merge direction
- AC4: Claude Code can then offer to merge using `contacts merge`

### `qnp-crm contacts merge <id1> <id2>` — WRITE tier

Merge two contacts. Second contact's fields fill gaps in first; second is soft-deleted.

```bash
qnp-crm contacts merge abc12345 def67890 --confirm
```

**Without --confirm** — shows merge preview (which fields come from where).

**Acceptance Criteria:**
- AC1: First contact (id1) is the "keep" target. Second (id2) is the source
- AC2: Source values fill NULL fields in target only. Target's existing values preserved
- AC3: Tags from both contacts combined
- AC4: Org links transferred from source to target
- AC5: Donation records re-linked (UPDATE donations SET contact_id = target WHERE contact_id = source)
- AC6: Source contact gets `merged_into = target.id`
- AC7: Audit log entries for both contacts
- AC8: Plan shows field-by-field merge result

### `qnp-crm contacts link <contact> <org>` — WRITE tier

Link a contact to an organisation.

```bash
qnp-crm contacts link abc12345 org56789 --role "Board Chair" --confirm
```

**Acceptance Criteria:**
- AC1: Creates contact ↔ org association with optional role
- AC2: `--primary` marks as primary organisation
- AC3: Duplicate link (same contact + org) rejected with existing link details
- AC4: Audit log entry

### `qnp-crm orgs add <name>` — WRITE tier

Create a new organisation.

```bash
qnp-crm orgs add "Good Corp" --abn 12345678901 --org-type corporate --confirm
```

**Acceptance Criteria:**
- AC1: `name` required (positional arg)
- AC2: ABN validated (11 digits)
- AC3: Duplicate ABN → hard fail with existing org details
- AC4: `--org-type` freeform (charity, corporate, government, school, other)

### `qnp-crm orgs list` — READ tier

```bash
qnp-crm orgs list
qnp-crm orgs list --org-type charity
```

### `qnp-crm orgs show <id>` — READ tier

```bash
qnp-crm orgs show org56789
```

**Acceptance Criteria:**
- AC1: Returns full org with linked contacts (with roles) and tags
- AC2: Accepts UUID prefix or name

## Australian Context

- Currency: AUD, always
- Financial year: 1 July – 30 June
- Address: "suburb" not "city"
- States: VIC, NSW, QLD, SA, WA, TAS, NT, ACT
- Postcode: 4 digits
- ABN: 11 digits
- Phone: stored as-is, no normalisation in v1

## NanoClaw Integration

### Container Skill

`container/skills/crm/SKILL.md` teaches Claude Code:
- All commands with syntax and examples
- Three-tier confirmation rules
- Common user queries → command mappings
- Proactive observation patterns (e.g., "no email on file")

### How Claude Code Uses These Commands

1. User sends WhatsApp message: "Add Jane Smith, email jane@example.org, she's a donor"
2. Claude Code runs: `qnp-crm contacts add "Jane" "Smith" --email jane@example.org --type donor`
3. Gets plan JSON back (WRITE tier, no `--confirm`)
4. Replies to user: "I'll add Jane Smith as a donor with email jane@example.org. Go ahead?"
5. User replies: "yep"
6. Claude Code runs: `qnp-crm contacts add "Jane" "Smith" --email jane@example.org --type donor --confirm`
7. Gets result, replies: "Done. Jane Smith added as a donor."

### Proactive Hints

After each command, Claude Code checks `hints[]` in the result:
- After add with no email: "No email on file — you'll need one before generating DGR receipts."
- After list with `hasMore`: "Showing first 50 — use --offset 50 for more."
- After search with no results: suggest broader search terms

## Non-Goals (v1)

- Web UI — agent and CLI only
- Real-time sync with external CRMs
- Permission/role system — single-tenant appliance
- Phone number normalisation (E.164) — store as-is for now
- Contact-contact relationships — use tags or add later
- Saved searches / list views — query each time
