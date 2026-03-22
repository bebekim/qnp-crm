# qnp-crm — CRM Tools for NanoClaw

You have access to `qnp-crm`, a single CLI tool for managing contacts, donations, and DGR receipts
for an Australian nonprofit. Commands are organised by domain and trust tier.
All connect to a PostgreSQL database on the host.

## Domains by Trust Tier

| Domain | Tier | Purpose |
|--------|------|---------|
| `qnp-crm contacts` | WRITE | Contacts and organisations |
| `qnp-crm donations` | WRITE | Donation records |
| `qnp-crm receipts` | RECEIPT | DGR receipts and statements (bright line) |
| `qnp-crm reports` | READ | Reports, search, deadlines, job history |
| `qnp-crm config` | WRITE | Receipt configuration |

## Quick Reference

```bash
# Search (across contacts, orgs, and donations)
qnp-crm search "Jane"
qnp-crm search "building appeal" --type donation
qnp-crm search "Good Corp" --type org --limit 10

# Contacts
qnp-crm contacts add "Jane" "Smith" --email jane@example.org --type donor
qnp-crm contacts list --type donor --tag vip
qnp-crm contacts search "Jane"
qnp-crm contacts show <id-or-email>
qnp-crm contacts edit <id> --phone "0499 111 222"
qnp-crm contacts history <id>                        # Activity timeline
qnp-crm contacts history <id> --from 2026-01-01 --limit 20
qnp-crm contacts import data.csv --on-duplicate skip  # CSV import (WRITE tier)
qnp-crm contacts import data.csv --preset salesforce --on-duplicate update --tag "imported"
qnp-crm contacts delete <id>
qnp-crm contacts export --type donor -o donors.csv
qnp-crm contacts dedup
qnp-crm contacts merge <id1> <id2>
qnp-crm contacts link <contact> <org> --role "Board Chair"

# Organisations
qnp-crm orgs add "Good Corp" --abn 12345678901 --org-type corporate
qnp-crm orgs list
qnp-crm orgs show <id-or-name>

# Donations
qnp-crm donations add 250 --contact "Jane Smith" --method eft --date 2026-03-01
qnp-crm donations list --from 2026-01-01 --to 2026-03-31 --unreceipted
qnp-crm donations show <id>
qnp-crm donations edit <id> --fund "building-appeal"
qnp-crm donations void <id> --reason "Duplicate entry"

# Receipts (HARD STOP — always confirm with user first)
qnp-crm receipts generate <donation-id>
qnp-crm receipts generate <donation-id> --confirm --send
qnp-crm receipts batch --from 2026-03-01 --to 2026-03-08
qnp-crm receipts batch --from 2026-03-01 --to 2026-03-08 --confirm --send
qnp-crm receipts void <receipt-number> --reason "Incorrect amount" --confirm
qnp-crm receipts reprint <receipt-number>

# Statements
qnp-crm statements generate <contact> --fy 2025-2026
qnp-crm statements generate <contact> --fy 2025-2026 --confirm --send

# Reports
qnp-crm reports summary --from 2026-01-01 --to 2026-06-30
qnp-crm reports by-donor --from 2025-07-01 --to 2026-06-30
qnp-crm reports by-fund --from 2025-07-01 --to 2026-06-30
qnp-crm reports by-month --from 2025-01-01
qnp-crm reports lapsed --gave-from 2024-07-01 --gave-to 2025-06-30 --not-from 2025-07-01
qnp-crm reports unreceipted
qnp-crm reports deadlines                            # Upcoming deadlines & action items
qnp-crm reports deadlines --days 60                  # Look ahead 60 days

# Jobs (scheduled task history)
qnp-crm jobs history                                 # Recent job runs
qnp-crm jobs history --task <id> --status error
qnp-crm jobs history --from 2026-03-01 --limit 20

# Deadlines (top-level alias)
qnp-crm deadlines
qnp-crm deadlines --days 60

# Pipe composition
qnp-crm contacts show "Jane" | qnp-crm donations add 500 --method eft
qnp-crm donations list --unreceipted | qnp-crm receipts batch --send

# Config
qnp-crm config show
qnp-crm config set dgr_name "Our Village Inc."
```

## Output Format

All commands output JSON by default. Use `--format table` for human-readable output.
When the user asks a question, run the command, then summarise the JSON result
in a natural WhatsApp-friendly message. Do NOT paste raw JSON to the user.

## Three-Tier Confirmation Rules

Every command has a tier. You MUST follow these rules exactly.

### READ tier (execute immediately)
Commands: `qnp-crm reports *`, `qnp-crm contacts list/show/search/history/export`, `qnp-crm donations list/show`, `qnp-crm config show`, `qnp-crm search`, `qnp-crm deadlines`, `qnp-crm jobs history`

Run immediately. Show results to the user. No confirmation needed.

### WRITE tier (confirm before executing)
Commands: `qnp-crm contacts add/edit/delete/import/link/merge`, `qnp-crm donations add/edit/void`, `qnp-crm config set`

1. Run WITHOUT `--confirm` first. The tool will output a plan showing what will change.
2. Show the plan to the user: "I'll add Jane Smith as a donor with email jane@example.org. Go ahead?"
3. If user confirms → re-run WITH `--confirm`.
4. If user says something else → treat as a new request, discard the plan.

### RECEIPT tier (hard stop — explicit YES required)
Commands: `qnp-crm receipts *`

1. Run WITHOUT `--confirm`. The tool outputs a detailed plan: receipt numbers, amounts, recipients.
2. Show the FULL plan to the user. Be explicit about what will happen:
   "I'll generate 3 DGR receipts:
   - Receipt #44 — Jane Smith — $250
   - Receipt #45 — Tom Nguyen — $150
   - Receipt #46 — Good Corp — $1,000
   Total: $1,400. Email to donors? Reply YES to proceed."
3. ONLY proceed if the user replies with an unambiguous YES.
4. Then re-run WITH `--confirm`.

## The Bright Line

Receipt and statement PDFs are generated by deterministic code. You MUST NOT:
- Write or modify receipt content yourself
- Suggest receipt numbers
- Edit receipt PDFs
- Bypass the `--confirm` flag by any means

You MAY:
- Help the user decide WHICH donations to receipt
- Suggest corrections before receipting (e.g. "Jane's address is missing — update it first?")
- Summarise receipt results after generation
- Draft thank-you messages to accompany receipts (but these are separate from the receipt itself)

## Australian Context

- Currency: AUD, always
- Financial year: 1 July – 30 June
- Address: use "suburb" not "city"
- States: VIC, NSW, QLD, SA, WA, TAS, NT, ACT
- Postcode: 4 digits
- ABN: 11 digits
- DGR = Deductible Gift Recipient (tax-deductible donation status)

## Common User Queries → Commands

| User says | You run |
|-----------|---------|
| "How much did we raise last month?" | `qnp-crm reports summary --from <month-start> --to <month-end>` |
| "Any new donations this week?" | `qnp-crm donations list --from <monday>` |
| "Add a $500 donation from Jane" | `qnp-crm donations add 500 --contact "Jane" --method eft` (WRITE tier) |
| "Send receipts for this week" | `qnp-crm receipts batch --from <monday> --to <today>` (RECEIPT tier) |
| "Who are our VIP donors?" | `qnp-crm contacts list --tag vip --type donor` |
| "Jane's phone changed to 0499..." | `qnp-crm contacts edit "Jane Smith" --phone "0499..."` (WRITE tier) |
| "EOFY statements for all donors" | `qnp-crm statements generate --all --fy <current-fy>` (RECEIPT tier) |
| "Who gave last year but not this year?" | `qnp-crm reports lapsed --gave-from <prev-fy-start> --gave-to <prev-fy-end> --not-from <cur-fy-start>` |
| "Import this CSV of donors" | `qnp-crm contacts import <file>` then `--confirm` (WRITE tier) |
| "What's Jane's history?" | `qnp-crm contacts history <jane-id>` |
| "Find anything about building appeal" | `qnp-crm search "building appeal"` |
| "What deadlines are coming up?" | `qnp-crm deadlines` |
| "Any overdue receipts?" | `qnp-crm deadlines` |
| "Did the nightly jobs run?" | `qnp-crm jobs history --limit 10` |
| "Any failed jobs?" | `qnp-crm jobs history --status error` |

## Proactive Observations

After running a command, look at the result and offer relevant follow-ups:
- After listing donations: "5 of these are unreceipted — want me to generate receipts?"
- After adding a contact: "They don't have an email — you'll need one before generating receipts."
- After a report: "Donations are down 20% from last month."
- After a search with no results: "No exact match — try a broader search?"

## Structured Command Mode (Preferred)

Instead of constructing raw CLI strings, use `validate` with a structured JSON object.
`qnp-crm` has `validate`, `verify`, and `schema` subcommands.
This prevents hallucinated commands, invalid parameters, and type errors.

### Step 1: Validate before executing

```bash
qnp-crm validate '{"command":"contacts.add","params":{"firstName":"Jane","lastName":"Smith","email":"jane@example.org","type":"donor"}}'
```

Output includes the validated `cliString` and `tier`. If validation fails, you'll get specific
error messages (e.g. "state: Invalid enum value" or "amount: Number must be greater than 0").

### Step 2: Execute the validated command

Use the `cliString` from the validation output, OR use `verify` for write/receipt
operations to get post-execution verification:

```bash
qnp-crm verify '{"command":"donations.add","params":{"amount":500,"contact":"Jane Smith","method":"eft"},"expect":{"ok":true,"hasPlan":true,"count":0}}'
```

### Step 3: Verify after confirming

When re-running with `--confirm`, include expectations about the result:

```bash
qnp-crm verify '{"command":"donations.add","params":{"amount":500,"contact":"Jane Smith","method":"eft","confirm":true},"expect":{"ok":true,"count":1,"fields":{"amount":{"equals":"500.00"},"method":{"equals":"eft"}}}}'
```

If the actual result diverges from expectations, the output will include `divergences`
with details on what didn't match. Report these to the user before proceeding.

### Available commands

```bash
qnp-crm schema  # Full registry of all commands
```

### Expectation fields

| Field | Type | Example |
|-------|------|---------|
| `ok` | boolean | `true` — expect success |
| `count` | number or `{min, max}` | `1` or `{"min": 1}` |
| `hasPlan` | boolean | `true` — expect plan (no --confirm) |
| `fields` | field checks | `{"name": {"contains": "Jane"}}` |
| `warningCount` | `{min, max}` | `{"max": 0}` |

Field check types: `{equals: value}`, `{contains: "str"}`, `{matches: "regex"}`,
`{type: "string"}`, `{present: true}`

### When to use verify vs raw CLI

- **Always use validate** for any command you're about to run. It catches typos, bad enums,
  missing required fields, and wrong types before they hit the database.
- **Use verify** for WRITE and RECEIPT tier commands where you have a specific expectation
  about the result. This catches semantic errors (right syntax, wrong outcome).
- **Raw CLI is still fine** for READ tier commands where you're exploring (list, search, show).

## Error Handling

If a command fails, read the error message carefully. Common issues:
- "Duplicate email" → contact already exists, suggest `qnp-crm contacts show` or `qnp-crm contacts edit`
- "Receipt config not set" → run `qnp-crm config set` for required fields first
- "Cannot receipt anonymous donation" → link a contact first with `qnp-crm donations edit`
- "Donation already receipted" → suggest `qnp-crm receipts reprint` for a duplicate copy
