import * as schema from "../db/schema.js";

export interface SeedResult {
  contacts: {
    janeSmith: string;
    bobWilliams: string;
    priyaPatel: string;
    tomNguyen: string;
  };
  orgs: {
    communityFoundation: string;
    localBusinessCouncil: string;
  };
  donations: {
    janeEft250: string;
    janeCash100: string;
    bobEft500: string;
    bobCard50: string;
    priyaCash30: string;
    tomMonthly100: string;
  };
}

export async function seedTestData(db: any): Promise<SeedResult> {
  // Receipt config (singleton — must exist for receipt generation)
  await db.insert(schema.receiptConfig).values({
    id: 1,
    orgName: "Wattle Creek Community House Inc.",
    dgrName: "Wattle Creek Community House Inc.",
    abn: "51824753556",
    address: "42 Banksia Lane, Eltham VIC 3095",
    dgrItemNumber: "1",
    receiptPrefix: "RC-",
    receiptFooter:
      "No goods or services were provided in return for this donation.",
    emailFrom: "receipts@wattlecreek.org.au",
    emailReplyTo: "admin@wattlecreek.org.au",
  });

  // --- Contacts ---

  const [jane] = await db
    .insert(schema.contacts)
    .values({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane.smith@bigpond.com.au",
      phone: "0412 345 678",
      addressLine1: "14 Gumtree Rd",
      suburb: "Eltham",
      state: "VIC",
      postcode: "3095",
      contactType: "donor",
    })
    .returning();

  const [bob] = await db
    .insert(schema.contacts)
    .values({
      firstName: "Bob",
      lastName: "Williams",
      email: "bob.w@gmail.com",
      phone: "0423 456 789",
      addressLine1: "7/22 Eucalyptus Ct",
      suburb: "Research",
      state: "VIC",
      postcode: "3095",
      contactType: "donor",
    })
    .returning();

  const [priya] = await db
    .insert(schema.contacts)
    .values({
      firstName: "Priya",
      lastName: "Patel",
      phone: "0434 567 890",
      suburb: "Diamond Creek",
      state: "VIC",
      postcode: "3089",
      contactType: "volunteer",
    })
    .returning();

  const [tom] = await db
    .insert(schema.contacts)
    .values({
      firstName: "Tom",
      lastName: "Nguyen",
      email: "tom.nguyen@optusnet.com.au",
      phone: "0445 678 901",
      addressLine1: "3 Wattle St",
      suburb: "Greensborough",
      state: "VIC",
      postcode: "3088",
      contactType: "donor",
    })
    .returning();

  // --- Organisations ---

  const [foundation] = await db
    .insert(schema.organisations)
    .values({
      name: "Nillumbik Community Foundation",
      orgType: "foundation",
      abn: "98765432100",
      suburb: "Eltham",
      state: "VIC",
      postcode: "3095",
    })
    .returning();

  const [council] = await db
    .insert(schema.organisations)
    .values({
      name: "Eltham Business Council",
      orgType: "business",
      abn: "11223344556",
      suburb: "Eltham",
      state: "VIC",
      postcode: "3095",
    })
    .returning();

  // --- Contact-Org link ---

  await db.insert(schema.contactOrgLinks).values({
    contactId: jane.id,
    orgId: foundation.id,
    role: "Board Chair",
    isPrimary: true,
  });

  // --- Tags ---

  await db.insert(schema.tags).values([
    { entityType: "contact", entityId: jane.id, key: "vip" },
    {
      entityType: "contact",
      entityId: jane.id,
      key: "source",
      value: "gala-2025",
    },
    {
      entityType: "contact",
      entityId: bob.id,
      key: "source",
      value: "website",
    },
    { entityType: "org", entityId: foundation.id, key: "partner" },
  ]);

  // --- Donations ---

  const [janeEft] = await db
    .insert(schema.donations)
    .values({
      contactId: jane.id,
      amount: "250.00",
      donationDate: "2025-11-15",
      method: "eft",
      fund: "general",
      status: "received",
      isDgrEligible: true,
    })
    .returning();

  const [janeCash] = await db
    .insert(schema.donations)
    .values({
      contactId: jane.id,
      amount: "100.00",
      donationDate: "2025-12-20",
      method: "cash",
      fund: "building",
      status: "received",
      isDgrEligible: false,
    })
    .returning();

  const [bobEft] = await db
    .insert(schema.donations)
    .values({
      contactId: bob.id,
      amount: "500.00",
      donationDate: "2026-01-10",
      method: "eft",
      fund: "general",
      status: "received",
      isDgrEligible: true,
      campaign: "summer-appeal",
    })
    .returning();

  const [bobCard] = await db
    .insert(schema.donations)
    .values({
      contactId: bob.id,
      amount: "50.00",
      donationDate: "2026-02-14",
      method: "card",
      fund: "general",
      status: "received",
      isDgrEligible: true,
    })
    .returning();

  const [priyaCash] = await db
    .insert(schema.donations)
    .values({
      contactId: priya.id,
      amount: "30.00",
      donationDate: "2026-01-20",
      method: "cash",
      fund: "general",
      status: "received",
      isDgrEligible: true,
    })
    .returning();

  const [tomMonthly] = await db
    .insert(schema.donations)
    .values({
      contactId: tom.id,
      amount: "100.00",
      donationDate: "2026-03-01",
      method: "eft",
      fund: "general",
      status: "received",
      isDgrEligible: true,
    })
    .returning();

  return {
    contacts: {
      janeSmith: jane.id,
      bobWilliams: bob.id,
      priyaPatel: priya.id,
      tomNguyen: tom.id,
    },
    orgs: {
      communityFoundation: foundation.id,
      localBusinessCouncil: council.id,
    },
    donations: {
      janeEft250: janeEft.id,
      janeCash100: janeCash.id,
      bobEft500: bobEft.id,
      bobCard50: bobCard.id,
      priyaCash30: priyaCash.id,
      tomMonthly100: tomMonthly.id,
    },
  };
}
