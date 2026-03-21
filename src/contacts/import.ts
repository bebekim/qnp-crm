import fs from "fs";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult, type CommandPlan } from "../types.js";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

interface ImportOpts {
  map?: string[];
  preset?: string;
  onDuplicate?: string;
  tag?: string[];
  type?: string;
  confirm: boolean;
}

// Column name aliases → canonical field name
const COLUMN_ALIASES: Record<string, string> = {
  // firstName
  "firstname": "firstName",
  "first_name": "firstName",
  "first name": "firstName",
  "given name": "firstName",
  "givenname": "firstName",
  // lastName
  "lastname": "lastName",
  "last_name": "lastName",
  "last name": "lastName",
  "surname": "lastName",
  "family name": "lastName",
  "familyname": "lastName",
  // email
  "email": "email",
  "email address": "email",
  "emailaddress": "email",
  "e-mail": "email",
  // phone
  "phone": "phone",
  "phone number": "phone",
  "phonenumber": "phone",
  "mobile": "phone",
  "mobile phone": "phone",
  // address
  "addressline1": "addressLine1",
  "address_line1": "addressLine1",
  "address line 1": "addressLine1",
  "street": "addressLine1",
  "street address": "addressLine1",
  "mailing street": "addressLine1",
  "mailingstreet": "addressLine1",
  "addressline2": "addressLine2",
  "address_line2": "addressLine2",
  "address line 2": "addressLine2",
  // suburb
  "suburb": "suburb",
  "city": "suburb",
  "mailing city": "suburb",
  "mailingcity": "suburb",
  // state
  "state": "state",
  "mailing state": "state",
  "mailingstate": "state",
  "state/province": "state",
  // postcode
  "postcode": "postcode",
  "postal code": "postcode",
  "postalcode": "postcode",
  "zip": "postcode",
  "zip code": "postcode",
  "mailing zip": "postcode",
  "mailingzip": "postcode",
  // type
  "type": "contactType",
  "contact type": "contactType",
  "contacttype": "contactType",
  "contact_type": "contactType",
  // notes
  "notes": "notes",
  "description": "notes",
  "comment": "notes",
  "comments": "notes",
};

// Salesforce preset mappings
const SALESFORCE_PRESET: Record<string, string> = {
  "First Name": "firstName",
  "Last Name": "lastName",
  "Email": "email",
  "Phone": "phone",
  "Mailing Street": "addressLine1",
  "Mailing City": "suburb",
  "Mailing State/Province": "state",
  "Mailing Zip/Postal Code": "postcode",
  "Description": "notes",
  "Contact Record Type": "contactType",
};

const VALID_FIELDS = new Set([
  "firstName", "lastName", "email", "phone",
  "addressLine1", "addressLine2", "suburb", "state", "postcode",
  "contactType", "notes",
]);

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
}

function buildColumnMap(headers: string[], opts: ImportOpts): Record<string, string> {
  const map: Record<string, string> = {};

  // Start with preset if provided
  if (opts.preset === "salesforce") {
    Object.assign(map, SALESFORCE_PRESET);
  }

  // Auto-match by alias
  for (const header of headers) {
    if (map[header]) continue; // already mapped
    const normalized = header.toLowerCase().trim();
    if (COLUMN_ALIASES[normalized]) {
      map[header] = COLUMN_ALIASES[normalized];
    }
  }

  // Override with explicit --map args
  if (opts.map) {
    for (const m of opts.map) {
      const eqIdx = m.indexOf("=");
      if (eqIdx === -1) continue;
      const csvCol = m.slice(0, eqIdx).trim();
      const field = m.slice(eqIdx + 1).trim();
      if (VALID_FIELDS.has(field)) {
        map[csvCol] = field;
      }
    }
  }

  return map;
}

function parseRows(records: Record<string, string>[], columnMap: Record<string, string>): ParsedRow[] {
  return records.map((record, idx) => {
    const rowNumber = idx + 2; // 1-indexed, +1 for header
    const data: Record<string, string> = {};
    const errors: string[] = [];

    for (const [csvCol, field] of Object.entries(columnMap)) {
      const value = record[csvCol]?.trim();
      if (value) {
        data[field] = value;
      }
    }

    // Validate required fields
    if (!data.firstName && !data.lastName) {
      errors.push("Missing first and last name");
    } else if (!data.lastName) {
      errors.push("Missing last name");
    }

    // Validate email format if present
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.push(`Invalid email: ${data.email}`);
    }

    // Validate state if present
    const validStates = new Set(["VIC", "NSW", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);
    if (data.state) {
      data.state = data.state.toUpperCase();
      if (!validStates.has(data.state)) {
        errors.push(`Invalid state: ${data.state}`);
      }
    }

    // Validate postcode if present
    if (data.postcode && !/^\d{4}$/.test(data.postcode)) {
      errors.push(`Invalid postcode: ${data.postcode}`);
    }

    // Default contactType
    if (!data.contactType) {
      data.contactType = "other";
    }

    return { rowNumber, data, errors };
  });
}

export async function contactsImport(
  file: string,
  opts: ImportOpts
): Promise<CommandResult<ImportResult | null>> {
  // Read and parse CSV
  if (!fs.existsSync(file)) {
    return fail(`File not found: ${file}`);
  }

  const csvContent = fs.readFileSync(file, "utf-8");
  let records: Record<string, string>[];
  try {
    records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return fail(`CSV parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (records.length === 0) {
    return fail("CSV file is empty or has no data rows");
  }

  const headers = Object.keys(records[0]);
  const columnMap = buildColumnMap(headers, opts);

  // Check we can map at least firstName or lastName
  const mappedFields = new Set(Object.values(columnMap));
  if (!mappedFields.has("firstName") && !mappedFields.has("lastName")) {
    const unmapped = headers.filter(h => !columnMap[h]);
    return fail(
      `Cannot auto-map name columns. CSV headers: ${headers.join(", ")}. ` +
      `Use --map "Column Name=firstName" to specify mapping.`
    );
  }

  const parsed = parseRows(records, columnMap);
  const validRows = parsed.filter(r => r.errors.length === 0);
  const errorRows = parsed.filter(r => r.errors.length > 0);

  // Check for duplicates against existing contacts
  const db = connect();
  const onDuplicate = opts.onDuplicate ?? "skip";
  const duplicateRows: ParsedRow[] = [];
  const newRows: ParsedRow[] = [];

  const emailsInCsv = validRows.filter(r => r.data.email).map(r => r.data.email!);
  const existingEmails = new Map<string, string>();

  if (emailsInCsv.length > 0) {
    const existing: any[] = await db.execute(
      sql_raw_array(`SELECT id, email FROM contacts WHERE email = ANY(ARRAY[${emailsInCsv.map(e => `'${e.replace(/'/g, "''")}'`).join(",")}])`)
    );
    for (const row of existing) {
      existingEmails.set(row.email.toLowerCase(), row.id);
    }
  }

  for (const row of validRows) {
    if (row.data.email && existingEmails.has(row.data.email.toLowerCase())) {
      duplicateRows.push(row);
    } else {
      newRows.push(row);
    }
  }

  const warnings: string[] = [];
  for (const row of errorRows) {
    warnings.push(`Row ${row.rowNumber}: ${row.errors.join(", ")}`);
  }
  for (const row of duplicateRows) {
    warnings.push(`Row ${row.rowNumber}: Duplicate email ${row.data.email}`);
  }

  const toImport = onDuplicate === "update"
    ? [...newRows, ...duplicateRows]
    : newRows;

  // Without --confirm: output plan
  if (!opts.confirm) {
    const args = [`import "${file}"`];
    if (opts.preset) args.push(`--preset ${opts.preset}`);
    if (opts.map) for (const m of opts.map) args.push(`--map "${m}"`);
    if (opts.onDuplicate) args.push(`--on-duplicate ${opts.onDuplicate}`);
    if (opts.tag) for (const t of opts.tag) args.push(`--tag "${t}"`);
    if (opts.type) args.push(`--type ${opts.type}`);
    args.push("--confirm");

    const plan: CommandPlan = {
      action: `Import ${toImport.length} contacts from ${file.split("/").pop()}`,
      details: {
        totalRows: records.length,
        valid: validRows.length,
        duplicates: duplicateRows.length,
        errors: errorRows.length,
        willImport: toImport.length,
        onDuplicate,
        mappedColumns: Object.entries(columnMap).map(([k, v]) => `${k} → ${v}`).join(", "),
      },
      tier: "write",
      confirmCommand: `qnp-crm contacts ${args.join(" ")}`,
    };

    const result = needsConfirm<ImportResult | null>(null, plan);
    result.warnings = warnings;
    return result;
  }

  // With --confirm: execute in transaction
  const contactType = opts.type ?? "other";
  const perf = performer();
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  // Process in a single transaction-like batch
  for (const row of toImport) {
    try {
      const isDuplicate = row.data.email && existingEmails.has(row.data.email.toLowerCase());

      if (isDuplicate && onDuplicate === "update") {
        const existingId = existingEmails.get(row.data.email!.toLowerCase())!;
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (row.data.firstName) updateData.firstName = row.data.firstName;
        if (row.data.lastName) updateData.lastName = row.data.lastName;
        if (row.data.phone) updateData.phone = row.data.phone;
        if (row.data.addressLine1) updateData.addressLine1 = row.data.addressLine1;
        if (row.data.addressLine2) updateData.addressLine2 = row.data.addressLine2;
        if (row.data.suburb) updateData.suburb = row.data.suburb;
        if (row.data.state) updateData.state = row.data.state;
        if (row.data.postcode) updateData.postcode = row.data.postcode;

        await db.update(schema.contacts)
          .set(updateData)
          .where(eq(schema.contacts.id, existingId));
        await audit(db, { table: "contacts", recordId: existingId, action: "UPDATE", by: perf });
        imported++;
      } else if (isDuplicate && onDuplicate === "skip") {
        skipped++;
      } else {
        // Insert new contact
        const [inserted] = await db.insert(schema.contacts).values({
          firstName: row.data.firstName ?? "",
          lastName: row.data.lastName ?? "",
          email: row.data.email || undefined,
          phone: row.data.phone || undefined,
          addressLine1: row.data.addressLine1 || undefined,
          addressLine2: row.data.addressLine2 || undefined,
          suburb: row.data.suburb || undefined,
          state: row.data.state || undefined,
          postcode: row.data.postcode || undefined,
          contactType: row.data.contactType ?? contactType,
          notes: row.data.notes || undefined,
        }).returning();

        // Tags
        if (opts.tag?.length) {
          const tagRows = opts.tag.map((t) => {
            const [key, value] = t.includes("=") ? t.split("=", 2) : [t, undefined];
            return { entityType: "contact" as const, entityId: inserted.id, key: key!, value };
          });
          await db.insert(schema.tags).values(tagRows);
        }

        await audit(db, { table: "contacts", recordId: inserted.id, action: "INSERT", by: perf });
        imported++;
      }
    } catch (err) {
      errors++;
      warnings.push(`Row ${row.rowNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  skipped += duplicateRows.length - (onDuplicate === "update" ? duplicateRows.length : 0);
  if (onDuplicate === "skip") skipped = duplicateRows.length;

  const result = ok<ImportResult>({ imported, skipped, errors }, imported);
  result.warnings = warnings;
  if (imported > 0) {
    result.hints.push(`${imported} contact${imported !== 1 ? "s" : ""} imported`);
  }
  if (skipped > 0) {
    result.hints.push(`${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped`);
  }

  return result;
}

// Helper for raw SQL since we can't use tagged template here
import { sql } from "drizzle-orm";
function sql_raw_array(query: string) {
  return sql.raw(query);
}
