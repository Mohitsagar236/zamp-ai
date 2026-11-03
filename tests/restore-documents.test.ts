import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  copyFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

it("restored-document verification detects corruption, extra files and symbolic links", async () => {
  const root = await mkdtemp(join(tmpdir(), "invoicelens-restore-document-"));
  const source = join(root, "source"),
    target = join(root, "restored");
  try {
    await mkdir(source);
    await mkdir(target);
    const name = randomUUID() + ".pdf";
    await writeFile(
      join(source, name),
      "%PDF-1.4\nSynthetic restore regression\n%%EOF",
    );
    await copyFile(join(source, name), join(target, name));
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/verify-restored-documents.mjs", source, target],
        { encoding: "utf8" },
      );
    expect(run().status).toBe(0);
    await writeFile(join(target, name), "corrupted");
    expect(run().stderr).toContain("bytes differ");
    await copyFile(join(source, name), join(target, name));
    const extra = join(target, randomUUID() + ".pdf");
    await writeFile(extra, "extra");
    expect(run().stderr).toContain("names differ");
    await rm(extra);
    await rm(join(target, name));
    await symlink(join(source, name), join(target, name));
    expect(run().stderr).toContain("regular files");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
