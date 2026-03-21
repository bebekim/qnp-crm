import { eq } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult, type ContactRow } from "../types.js";

interface AddOpts {
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  type: string;
  notes?: string;
  tag?: string[];
  confirm: boolean;
}

export async function contactsAdd(
  firstName: string,
  lastName: string,
  opts: AddOpts
): Promise<CommandResult<ContactRow | null>> {
  const db = connect();

  // Check duplicate email
  if (opts.email) {
    const [existing] = await db
      .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(eq(schema.contacts.email, opts.email))
      .limit(1);

    if (existing) {
      return fail(
        `Contact with email ${opts.email} already exists: ${existing.firstName} ${existing.lastName} (${existing.id.slice(0, 8)})`
      );
    }
  }

  // Without --confirm: output plan
  if (!opts.confirm) {
    const details: Record<string, unknown> = { name: `${firstName} ${lastName}`, type: opts.type };
    if (opts.email) details.email = opts.email;
    if (opts.phone) details.phone = opts.phone;
    if (opts.suburb) details.suburb = opts.suburb;
    if (opts.state) details.state = opts.state;
    if (opts.tag?.length) details.tags = opts.tag.join(", ");

    const args = [`add "${firstName}" "${lastName}"`];
    if (opts.email) args.push(`--email "${opts.email}"`);
    if (opts.phone) args.push(`--phone "${opts.phone}"`);
    if (opts.type !== "other") args.push(`--type ${opts.type}`);
    if (opts.suburb) args.push(`--suburb "${opts.suburb}"`);
    if (opts.state) args.push(`--state ${opts.state}`);
    if (opts.postcode) args.push(`--postcode ${opts.postcode}`);
    for (const t of opts.tag ?? []) args.push(`--tag "${t}"`);
    args.push("--confirm");

    return needsConfirm(null, {
      action: `Add contact: ${firstName} ${lastName}`,
      details,
      tier: "write",
      confirmCommand: `qnp-crm contacts ${args.join(" ")}`,
    });
  }

  // With --confirm: execute
  const [inserted] = await db
    .insert(schema.contacts)
    .values({
      firstName,
      lastName,
      email: opts.email,
      phone: opts.phone,
      addressLine1: opts.addressLine1,
      addressLine2: opts.addressLine2,
      suburb: opts.suburb,
      state: opts.state,
      postcode: opts.postcode,
      contactType: opts.type,
      notes: opts.notes,
    })
    .returning();

  // Tags
  if (opts.tag?.length) {
    const tagRows = opts.tag.map((t) => {
      const [key, value] = t.includes("=") ? t.split("=", 2) : [t, undefined];
      return { entityType: "contact" as const, entityId: inserted.id, key: key!, value };
    });
    await db.insert(schema.tags).values(tagRows);
  }

  await audit(db, { table: "contacts", recordId: inserted.id, action: "INSERT", by: performer() });

  const result = ok<ContactRow>({
    id: inserted.id.slice(0, 8),
    name: `${inserted.firstName} ${inserted.lastName}`,
    email: inserted.email,
    type: inserted.contactType,
    tags: (opts.tag ?? []).join(", "),
  });

  if (!inserted.email) {
    result.hints.push("No email on file — you'll need one before generating DGR receipts.");
  }

  return result;
}
