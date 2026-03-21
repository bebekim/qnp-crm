import { eq, sql } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult, type ContactRow } from "../types.js";

interface EditOpts {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  type?: string;
  notes?: string;
  addTag?: string[];
  removeTag?: string[];
  confirm: boolean;
}

export async function contactsEdit(
  idPrefix: string,
  opts: EditOpts
): Promise<CommandResult<ContactRow | null>> {
  const db = connect();

  // Resolve contact
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(sql`${schema.contacts.id}::text LIKE ${idPrefix + "%"}`)
    .limit(1);

  if (!contact) return fail(`Contact not found: "${idPrefix}"`);

  // Check ambiguous
  const [second] = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(sql`${schema.contacts.id}::text LIKE ${idPrefix + "%"} AND ${schema.contacts.id} != ${contact.id}`)
    .limit(1);

  if (second) {
    return fail(`Ambiguous ID prefix "${idPrefix}" matches multiple contacts. Use more characters.`);
  }

  // Build changes
  const updates: Record<string, unknown> = {};
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  const fieldMap: [keyof EditOpts, keyof typeof contact][] = [
    ["firstName", "firstName"],
    ["lastName", "lastName"],
    ["email", "email"],
    ["phone", "phone"],
    ["addressLine1", "addressLine1"],
    ["addressLine2", "addressLine2"],
    ["suburb", "suburb"],
    ["state", "state"],
    ["postcode", "postcode"],
    ["type", "contactType"],
    ["notes", "notes"],
  ];

  for (const [optKey, dbKey] of fieldMap) {
    const newVal = opts[optKey];
    if (newVal !== undefined) {
      const oldVal = contact[dbKey];
      if (String(newVal) !== String(oldVal ?? "")) {
        updates[dbKey as string] = newVal;
        changes[dbKey as string] = { old: oldVal, new: newVal };
      }
    }
  }

  const hasFieldChanges = Object.keys(updates).length > 0;
  const hasTagChanges = (opts.addTag?.length ?? 0) > 0 || (opts.removeTag?.length ?? 0) > 0;

  if (!hasFieldChanges && !hasTagChanges) {
    return fail("No changes specified. Use --first-name, --last-name, --email, --phone, --suburb, --state, --postcode, --type, --notes, --add-tag, --remove-tag");
  }

  // Check email uniqueness if changing email
  if (updates.email) {
    const [existing] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(sql`${schema.contacts.email} = ${updates.email} AND ${schema.contacts.id} != ${contact.id}`)
      .limit(1);

    if (existing) {
      return fail(`Email ${updates.email} is already used by another contact (${existing.id.slice(0, 8)}).`);
    }
  }

  // Without --confirm: output plan
  if (!opts.confirm) {
    const details: Record<string, unknown> = {
      contact: `${contact.firstName} ${contact.lastName} (${contact.id.slice(0, 8)})`,
    };
    for (const [field, change] of Object.entries(changes)) {
      details[field] = `"${change.old ?? ""}" → "${change.new}"`;
    }
    if (opts.addTag?.length) details.addTags = opts.addTag.join(", ");
    if (opts.removeTag?.length) details.removeTags = opts.removeTag.join(", ");

    const args = [`edit ${idPrefix}`];
    for (const [optKey] of fieldMap) {
      const v = opts[optKey];
      if (v !== undefined) {
        const flag = optKey.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
        args.push(`--${flag} "${v}"`);
      }
    }
    for (const t of opts.addTag ?? []) args.push(`--add-tag "${t}"`);
    for (const t of opts.removeTag ?? []) args.push(`--remove-tag "${t}"`);
    args.push("--confirm");

    return needsConfirm(null, {
      action: `Edit contact: ${contact.firstName} ${contact.lastName}`,
      details,
      tier: "write",
      confirmCommand: `qnp-crm contacts ${args.join(" ")}`,
    });
  }

  // With --confirm: execute
  if (hasFieldChanges) {
    updates.updatedAt = new Date();
    await db.update(schema.contacts).set(updates).where(eq(schema.contacts.id, contact.id));
  }

  // Tag additions
  if (opts.addTag?.length) {
    for (const t of opts.addTag) {
      const [key, value] = t.includes("=") ? t.split("=", 2) : [t, undefined];
      await db.insert(schema.tags).values({
        entityType: "contact",
        entityId: contact.id,
        key: key!,
        value,
      }).onConflictDoNothing();
    }
  }

  // Tag removals
  if (opts.removeTag?.length) {
    for (const t of opts.removeTag) {
      const [key] = t.includes("=") ? t.split("=", 2) : [t];
      await db.delete(schema.tags).where(
        sql`entity_type = 'contact' AND entity_id = ${contact.id} AND key = ${key}`
      );
    }
  }

  await audit(db, {
    table: "contacts",
    recordId: contact.id,
    action: "UPDATE",
    changes: {
      ...changes,
      ...(opts.addTag?.length ? { tagsAdded: { old: null, new: opts.addTag } } : {}),
      ...(opts.removeTag?.length ? { tagsRemoved: { old: opts.removeTag, new: null } } : {}),
    },
    by: performer(),
  });

  // Fetch updated tags
  const allTags = await db
    .select({ key: schema.tags.key, value: schema.tags.value })
    .from(schema.tags)
    .where(sql`entity_type = 'contact' AND entity_id = ${contact.id}`);

  const updatedFirst = (updates.firstName as string) ?? contact.firstName;
  const updatedLast = (updates.lastName as string) ?? contact.lastName;

  return ok<ContactRow>({
    id: contact.id.slice(0, 8),
    name: `${updatedFirst} ${updatedLast}`,
    email: (updates.email as string) ?? contact.email,
    type: (updates.contactType as string) ?? contact.contactType,
    tags: allTags.map((t) => (t.value ? `${t.key}=${t.value}` : t.key)).join(", "),
  });
}
