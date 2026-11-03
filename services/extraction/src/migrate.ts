import { readFile, readdir } from "node:fs/promises";
import { pool, transaction } from "./db.js";
try {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(90210)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const version = file.slice(0, -4);
      const already = await c.query(
        "SELECT 1 FROM schema_migrations WHERE version=$1",
        [version],
      );
      if (already.rowCount) continue;
      const legacy =
        version === "001"
          ? await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
              "v1",
            ])
          : { rowCount: 0 };
      if (!legacy.rowCount)
        await c.query(
          await readFile(
            new URL("../migrations/" + file, import.meta.url),
            "utf8",
          ),
        );
      await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        version,
      ]);
    }
  });
  console.log("Service migrations applied");
} finally {
  await pool.end();
}
