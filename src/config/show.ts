import { connect, schema } from "../db/connection.js";
import { ok, type CommandResult } from "../types.js";

export interface ConfigData {
  orgName: string | null;
  dgrName: string | null;
  abn: string | null;
  address: string | null;
  dgrItemNumber: string | null;
  receiptPrefix: string | null;
  logoPath: string | null;
  receiptFooter: string | null;
  emailFrom: string | null;
  emailReplyTo: string | null;
}

const VALID_KEYS: (keyof ConfigData)[] = [
  "orgName", "dgrName", "abn", "address", "dgrItemNumber",
  "receiptPrefix", "logoPath", "receiptFooter", "emailFrom", "emailReplyTo",
];

export { VALID_KEYS };

export async function configShow(): Promise<CommandResult<ConfigData | null>> {
  const db = connect();

  const [row] = await db.select().from(schema.receiptConfig).limit(1);

  if (!row) {
    const result = ok<ConfigData | null>(null, 0);
    result.hints.push("No config set yet. Use: qnp-crm config set <key> <value> --confirm");
    return result;
  }

  const data: ConfigData = {
    orgName: row.orgName,
    dgrName: row.dgrName,
    abn: row.abn,
    address: row.address,
    dgrItemNumber: row.dgrItemNumber,
    receiptPrefix: row.receiptPrefix,
    logoPath: row.logoPath,
    receiptFooter: row.receiptFooter,
    emailFrom: row.emailFrom,
    emailReplyTo: row.emailReplyTo,
  };

  const result = ok(data);
  const missing: string[] = [];
  if (!data.dgrName) missing.push("dgrName");
  if (!data.abn) missing.push("abn");
  if (missing.length > 0) {
    result.warnings.push(`Required for receipts but not set: ${missing.join(", ")}`);
  }
  return result;
}
