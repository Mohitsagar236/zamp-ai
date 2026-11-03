import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const name = process.argv[2];
if (!["workflow", "extraction", "decision"].includes(name))
  throw Error("Select a service");
const txt = await readFile(
  ".data/invoicelens-services/" + name + ".env",
  "utf8",
);
const env = Object.fromEntries(
  txt
    .trim()
    .split(/\r?\n/)
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
const p = spawn(
  process.execPath,
  ["--import", "tsx", `services/${name}/src/server.ts`],
  {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      NODE_ENV: "development",
      ...env,
    },
    stdio: "inherit",
  },
);
p.on("exit", (x) => process.exit(x ?? 0));
