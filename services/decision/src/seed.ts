import { transaction, pool } from "./db.js";
import { config } from "./config.js";
export async function seed() {
  if (config.APP_ENV !== "demo" && config.APP_ENV !== "test") return;
  await transaction(async (c) => {
    await c.query(
      `INSERT INTO vendors(id,name,identifier,aliases,approved) VALUES('v-northstar','Northstar Office Supplies','GST-NORTHSTAR-01','["Northstar Office Supplies","Northstar Office Supplies Pvt Ltd"]',true),('v-studio','Studio Meridian','GST-MERIDIAN-02','["Studio Meridian"]',true),('v-cloud','Cloudline Technologies','GST-CLOUDLINE-03','["Cloudline Technologies"]',true),('v-hold','Unverified Trading Co','GST-HOLD-04','["Unverified Trading Co"]',false) ON CONFLICT DO NOTHING`,
    );
    await c.query(
      `INSERT INTO purchase_orders(id,vendor_id,currency,status,limit_minor,description) VALUES('PO-2026-101','v-northstar','INR','open',20000000,'Office supplies · annual order'),('PO-2026-200','v-cloud','INR','open',10000000,'Cloud migration · split billing'),('PO-2026-301','v-studio','INR','open',10000000,'Brand design · phase one'),('PO-2026-302','v-studio','INR','open',10000000,'Website design · phase two'),('PO-2026-400','v-cloud','USD','closed',500000,'Closed support contract') ON CONFLICT DO NOTHING`,
    );
    await c.query(
      "INSERT INTO decision_records(invoice_id,content_hash,created_at,fields,review,generation) VALUES('historical-cloud-001',$1,now(),'{}','approved',1) ON CONFLICT DO NOTHING",
      ["0".repeat(64)],
    );
    await c.query(
      "INSERT INTO commitments(invoice_id,po_id,vendor_id,business_key,amount_minor,label,kind) VALUES('historical-cloud-001','PO-2026-200','v-cloud','v-cloud:HIST001',7000000,'HIST-001 · previously approved migration milestone','approval') ON CONFLICT DO NOTHING",
    );
  });
}
if (
  process.argv[1]?.endsWith("seed.ts") ||
  process.argv[1]?.endsWith("seed.js")
) {
  try {
    await seed();
  } finally {
    await pool.end();
  }
}
