import { eq } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult } from "../types.js";
import { VALID_KEYS, type ConfigData } from "./show.js";

// Map CLI snake_case keys to camelCase DB column names
const KEY_MAP: Record<string, keyof ConfigData> = {
  org_name: "orgName",
  dgr_name: "dgrName",
  abn: "abn",
  address: "address",
  dgr_item_number: "dgrItemNumber",
  receipt_prefix: "receiptPrefix",
  logo_path: "logoPath",
  receipt_footer: "receiptFooter",
  email_from: "emailFrom",
  email_reply_to: "emailReplyTo",
  // Also accept camelCase directly
  orgName: "orgName",
  dgrName: "dgrName",
  dgrItemNumber: "dgrItemNumber",
  receiptPrefix: "receiptPrefix",
  logoPath: "logoPath",
  receiptFooter: "receiptFooter",
  emailFrom: "emailFrom",
  emailReplyTo: "emailReplyTo",
};

interface SetOpts {
  confirm: boolean;
}

export async function configSet(
  key: string,
  value: string,
  opts: SetOpts
): Promise<CommandResult<{ key: string; value: string } | null>> {
  const colName = KEY_MAP[key];
  if (!colName) {
    return fail(`Unknown config key "${key}". Valid keys: ${Object.keys(KEY_MAP).filter(k => k.includes("_")).join(", ")}`);
  }

  if (key === "abn" || colName === "abn") {
    const stripped = value.replace(/\s/g, "");
    if (!/^\d{11}$/.test(stripped)) {
      return fail(`ABN must be exactly 11 digits. Got: "${value}"`);
    }
    value = stripped;
  }

  if (!opts.confirm) {
    return needsConfirm(null, {
      action: `Set config: ${key} = "${value}"`,
      details: { key, value },
      tier: "write",
      confirmCommand: `qnp-crm config set ${key} "${value}" --confirm`,
    });
  }

  const db = connect();

  // Upsert: check if config row exists
  const [existing] = await db.select().from(schema.receiptConfig).limit(1);
  const oldValue = existing ? (existing as any)[colName] : null;

  if (existing) {
    await db.update(schema.receiptConfig)
      .set({ [colName]: value, updatedAt: new Date() })
      .where(eq(schema.receiptConfig.id, 1));
  } else {
    await db.insert(schema.receiptConfig).values({ id: 1, [colName]: value });
  }

  await audit(db, {
    table: "receipt_config",
    recordId: "1",
    action: existing ? "UPDATE" : "INSERT",
    changes: { [colName]: { old: oldValue, new: value } },
    by: performer(),
  });

  return ok({ key, value });
}
