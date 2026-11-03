import { statfs } from "node:fs/promises";
import { pool } from "./db.js";
import { config } from "./config.js";

export async function metrics(): Promise<string> {
  const [jobs, invoices, heartbeat, cases] = await Promise.all([
    pool.query(
      "SELECT status,count(*)::int AS count,COALESCE(max(EXTRACT(EPOCH FROM now()-created_at)),0)::float AS oldest FROM workflow_jobs GROUP BY status",
    ),
    pool.query(
      "SELECT status,count(*)::int AS count FROM invoices GROUP BY status",
    ),
    pool.query(
      "SELECT COALESCE(max(EXTRACT(EPOCH FROM now()-at)),1000000000)::float AS age FROM workflow_heartbeat",
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM reconciliation_cases WHERE status='open'",
    ),
  ]);
  const lines = [
    "# TYPE invoicelens_jobs gauge",
    "# TYPE invoicelens_invoices gauge",
  ];
  for (const status of ["queued", "running", "completed", "failed"]) {
    lines.push(
      `invoicelens_jobs{status="${status}"} ${jobs.rows.find((row) => row.status === status)?.count ?? 0}`,
    );
    lines.push(
      `invoicelens_invoices{status="${status}"} ${invoices.rows.find((row) => row.status === status)?.count ?? 0}`,
    );
  }
  lines.push(
    "# TYPE invoicelens_oldest_queued_seconds gauge",
    `invoicelens_oldest_queued_seconds ${jobs.rows.find((row) => row.status === "queued")?.oldest ?? 0}`,
  );
  lines.push(
    "# TYPE invoicelens_worker_heartbeat_age_seconds gauge",
    `invoicelens_worker_heartbeat_age_seconds ${heartbeat.rows[0].age}`,
  );
  lines.push(
    "# TYPE invoicelens_reconciliation_open gauge",
    `invoicelens_reconciliation_open ${cases.rows[0].count}`,
  );
  try {
    const disk = await statfs(config.STORAGE_DIR);
    lines.push(
      "# TYPE invoicelens_storage_available_bytes gauge",
      `invoicelens_storage_available_bytes ${disk.bavail * disk.bsize}`,
      "# TYPE invoicelens_storage_total_bytes gauge",
      `invoicelens_storage_total_bytes ${disk.blocks * disk.bsize}`,
    );
  } catch {
    lines.push("# Storage volume has not been created or cannot be read.");
  }
  return lines.join("\n") + "\n";
}
