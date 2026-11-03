import { it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  beginExtraction,
  completeExtraction,
  EXTRACTOR_VERSION,
} from "../services/extraction/src/cache";
import { parseText } from "../services/extraction/src/parser";

it("preserves legacy results, versions new operations and fences concurrent/expired extraction leases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "invoicelens-cache-"));
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const pg = new EmbeddedPostgres({
    databaseDir: directory,
    user: "test",
    password: "isolated-only",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  let pool: Pool | undefined;
  try {
    await pg.initialise();
    await pg.start();
    pool = new Pool({
      connectionString: `postgresql://test:isolated-only@127.0.0.1:${port}/postgres`,
    });
    const tx = async <T>(fn: (c: PoolClient) => Promise<T>) => {
      const c = await pool!.connect();
      try {
        await c.query("BEGIN");
        const value = await fn(c);
        await c.query("COMMIT");
        return value;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    const result = (version: string, total: string) => ({
      ...parseText(`Total: ${total}`),
      text: `Total: ${total}`,
      pages: [{ page: 1, text: `Total: ${total}` }],
      provider: "PDF.js text",
      version,
      pageCount: 1,
    });
    await pool.query(
      await readFile("services/extraction/migrations/001.sql", "utf8"),
    );
    await pool.query(
      "INSERT INTO extraction_cache(hash,api_version,status) VALUES('legacy','1','completed')",
    );
    await pool.query(
      "INSERT INTO extraction_results(hash,api_version,result) VALUES('legacy','1',$1)",
      [JSON.stringify(result("label-parser/2.0", "100"))],
    );
    await pool.query(
      "INSERT INTO extraction_operations(idempotency_key,hash,api_version) VALUES('old-key','legacy','1')",
    );
    await pool.query(
      await readFile("services/extraction/migrations/002.sql", "utf8"),
    );
    const old = await tx((c) =>
      beginExtraction(c, "old-key", "legacy", randomUUID()),
    );
    expect(old).toMatchObject({
      cached: { version: "label-parser/2.0", fields: { total: "100" } },
    });
    const token = randomUUID();
    expect(
      await tx((c) => beginExtraction(c, "new-key", "legacy", token)),
    ).toEqual({ version: EXTRACTOR_VERSION });
    await tx((c) =>
      completeExtraction(
        c,
        "legacy",
        EXTRACTOR_VERSION,
        token,
        result(EXTRACTOR_VERSION, "200"),
      ),
    );
    expect(
      await tx((c) => beginExtraction(c, "new-key", "legacy", randomUUID())),
    ).toMatchObject({ cached: { fields: { total: "200" } } });
    expect(
      await tx((c) => beginExtraction(c, "old-key", "legacy", randomUUID())),
    ).toMatchObject({ cached: { fields: { total: "100" } } });
    const races = await Promise.allSettled(
      ["first", "second"].map((hash) =>
        tx((c) => beginExtraction(c, "racing-key", hash, randomUUID())),
      ),
    );
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(races.filter((r) => r.status === "rejected")).toHaveLength(1);
    const expired = randomUUID(),
      replacement = randomUUID();
    await tx((c) => beginExtraction(c, "lease-key", "leased", expired));
    await expect(
      tx((c) => beginExtraction(c, "lease-key", "leased", randomUUID())),
    ).rejects.toThrow(/in progress/);
    await pool.query(
      "UPDATE extraction_cache SET lease_until=now()-interval '1 second' WHERE hash='leased'",
    );
    await expect(
      tx((c) =>
        completeExtraction(
          c,
          "leased",
          EXTRACTOR_VERSION,
          expired,
          result(EXTRACTOR_VERSION, "1"),
        ),
      ),
    ).rejects.toThrow(/expired/);
    await tx((c) => beginExtraction(c, "lease-key", "leased", replacement));
    await expect(
      tx((c) =>
        completeExtraction(
          c,
          "leased",
          EXTRACTOR_VERSION,
          expired,
          result(EXTRACTOR_VERSION, "1"),
        ),
      ),
    ).rejects.toThrow(/expired/);
    await tx((c) =>
      completeExtraction(
        c,
        "leased",
        EXTRACTOR_VERSION,
        replacement,
        result(EXTRACTOR_VERSION, "2"),
      ),
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM extraction_results WHERE hash='leased'",
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await pool?.end();
    await pg.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
