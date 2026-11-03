import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const directory = process.argv.includes("--production")
  ? ".data/invoicelens-production"
  : ".data/invoicelens-services";
for (const name of ["workflow", "extraction", "decision"]) {
  const text = await readFile(directory + "/" + name + ".env", "utf8"),
    env = Object.fromEntries(
      text
        .trim()
        .split(/\r?\n/)
        .map((x) => {
          const i = x.indexOf("=");
          return [x.slice(0, i), x.slice(i + 1)];
        }),
    );
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", `services/${name}/src/migrate.ts`],
    {
      stdio: "inherit",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        NODE_ENV: "production",
        ...env,
      },
    },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}
