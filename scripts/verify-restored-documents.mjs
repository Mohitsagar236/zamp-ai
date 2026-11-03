import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const [source, target] = process.argv.slice(2);
if (!source || !target)
  throw new Error("Pass backup and restored document directories");
const originals = (await readdir(source)).sort();
const restored = (await readdir(target)).sort();
if (JSON.stringify(originals) !== JSON.stringify(restored))
  throw new Error("Restored document names differ from the backup");
for (const name of originals) {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(name))
    throw new Error("Unexpected document name in backup");
  for (const directory of [source, target]) {
    const info = await lstat(join(directory, name));
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Documents must be regular files");
  }
  const digest = async (directory) =>
    createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex");
  if ((await digest(source)) !== (await digest(target)))
    throw new Error("Restored document bytes differ from the backup");
}
console.log(
  `Restored document volume matches the backup: ${originals.length} file(s).`,
);
