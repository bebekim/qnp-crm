import { eq } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult } from "../types.js";

interface OrgAddOpts {
  abn?: string;
  orgType: string;
  addressLine1?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  phone?: string;
  website?: string;
  notes?: string;
  tag?: string[];
  confirm: boolean;
}

interface OrgRow {
  id: string;
  name: string;
  orgType: string;
  abn: string | null;
  tags: string;
}

export async function orgsAdd(
  name: string,
  opts: OrgAddOpts
): Promise<CommandResult<OrgRow | null>> {
  const db = connect();

  // Validate ABN if provided (11 digits, strip spaces)
  let abn: string | undefined = opts.abn;
  if (abn) {
    abn = abn.replace(/\s/g, "");
    if (!/^\d{11}$/.test(abn)) {
      return fail(`Invalid ABN: "${opts.abn}". Must be 11 digits.`);
    }
  }

  // Check duplicate ABN
  if (abn) {
    const [existing] = await db
      .select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.abn, abn))
      .limit(1);

    if (existing) {
      return fail(
        `Organisation with ABN ${abn} already exists: ${existing.name} (${existing.id.slice(0, 8)})`
      );
    }
  }

  // Without --confirm: output plan
  if (!opts.confirm) {
    const details: Record<string, unknown> = { name, orgType: opts.orgType };
    if (abn) details.abn = abn;
    if (opts.suburb) details.suburb = opts.suburb;
    if (opts.state) details.state = opts.state;
    if (opts.phone) details.phone = opts.phone;
    if (opts.website) details.website = opts.website;
    if (opts.tag?.length) details.tags = opts.tag.join(", ");

    const args = [`orgs add "${name}"`];
    args.push(`--org-type ${opts.orgType}`);
    if (abn) args.push(`--abn ${abn}`);
    if (opts.suburb) args.push(`--suburb "${opts.suburb}"`);
    if (opts.state) args.push(`--state ${opts.state}`);
    if (opts.postcode) args.push(`--postcode ${opts.postcode}`);
    if (opts.phone) args.push(`--phone "${opts.phone}"`);
    if (opts.website) args.push(`--website "${opts.website}"`);
    for (const t of opts.tag ?? []) args.push(`--tag "${t}"`);
    args.push("--confirm");

    return needsConfirm(null, {
      action: `Add organisation: ${name}`,
      details,
      tier: "write",
      confirmCommand: `qnp-crm contacts ${args.join(" ")}`,
    });
  }

  // With --confirm: execute
  const [inserted] = await db
    .insert(schema.organisations)
    .values({
      name,
      orgType: opts.orgType,
      abn: abn ?? null,
      addressLine1: opts.addressLine1,
      suburb: opts.suburb,
      state: opts.state,
      postcode: opts.postcode,
      phone: opts.phone,
      website: opts.website,
      notes: opts.notes,
    })
    .returning();

  // Tags
  if (opts.tag?.length) {
    const tagRows = opts.tag.map((t) => {
      const [key, value] = t.includes("=") ? t.split("=", 2) : [t, undefined];
      return { entityType: "org" as const, entityId: inserted.id, key: key!, value };
    });
    await db.insert(schema.tags).values(tagRows);
  }

  await audit(db, { table: "organisations", recordId: inserted.id, action: "INSERT", by: performer() });

  const result = ok<OrgRow>({
    id: inserted.id.slice(0, 8),
    name: inserted.name,
    orgType: inserted.orgType,
    abn: inserted.abn ?? null,
    tags: (opts.tag ?? []).join(", "),
  });

  result.hints.push(`Link contacts to this org: qnp-crm contacts link <contact-id> ${inserted.id.slice(0, 8)}`);

  return result;
}
