import { config } from "../src/lib/config";
import { db, pool } from "../src/lib/db";
import { vendors, pos, commitments } from "../src/lib/schema";
export async function seed() {
  if (config.APP_ENV === "production")
    throw Error("Synthetic seeding is restricted to demo/test environments.");
  await db.transaction(async (tx) => {
    await tx
      .insert(vendors)
      .values([
        {
          id: "v-northstar",
          name: "Northstar Office Supplies",
          identifier: "GST-NORTHSTAR-01",
          aliases: [
            "Northstar Office Supplies",
            "Northstar Office Supplies Pvt Ltd",
          ],
          approved: true,
        },
        {
          id: "v-studio",
          name: "Studio Meridian",
          identifier: "GST-MERIDIAN-02",
          aliases: ["Studio Meridian"],
          approved: true,
        },
        {
          id: "v-cloud",
          name: "Cloudline Technologies",
          identifier: "GST-CLOUDLINE-03",
          aliases: ["Cloudline Technologies"],
          approved: true,
        },
        {
          id: "v-hold",
          name: "Unverified Trading Co",
          identifier: "GST-HOLD-04",
          aliases: ["Unverified Trading Co"],
          approved: false,
        },
      ])
      .onConflictDoNothing();
    await tx
      .insert(pos)
      .values([
        {
          id: "PO-2026-101",
          vendorId: "v-northstar",
          currency: "INR",
          status: "open",
          limitMinor: 20000000n,
          description: "Office supplies · annual order",
        },
        {
          id: "PO-2026-200",
          vendorId: "v-cloud",
          currency: "INR",
          status: "open",
          limitMinor: 10000000n,
          description: "Cloud migration · split billing",
        },
        {
          id: "PO-2026-301",
          vendorId: "v-studio",
          currency: "INR",
          status: "open",
          limitMinor: 10000000n,
          description: "Brand design · phase one",
        },
        {
          id: "PO-2026-302",
          vendorId: "v-studio",
          currency: "INR",
          status: "open",
          limitMinor: 10000000n,
          description: "Website design · phase two",
        },
        {
          id: "PO-2026-400",
          vendorId: "v-cloud",
          currency: "USD",
          status: "closed",
          limitMinor: 500000n,
          description: "Closed support contract",
        },
      ])
      .onConflictDoNothing();
    await tx
      .insert(commitments)
      .values({
        invoiceId: "historical-cloud-001",
        poId: "PO-2026-200",
        vendorId: "v-cloud",
        businessKey: "v-cloud:HIST001",
        amountMinor: 7000000n,
        label: "HIST-001 · previously approved migration milestone",
      })
      .onConflictDoNothing();
  });
}
if (process.argv[1]?.endsWith("seed.ts")) {
  await seed();
  console.log("Demo reference records seeded (existing records preserved)");
  await pool.end();
}
