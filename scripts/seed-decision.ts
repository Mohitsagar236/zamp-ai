import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const text = await readFile(".data/invoicelens-services/decision.env", "utf8"),
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
  ["--import", "tsx", "services/decision/src/seed.ts"],
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
process.exit(r.status ?? 1);
