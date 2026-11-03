import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
const production = process.argv.includes("--production");
const dir = production
  ? ".data/invoicelens-production"
  : ".data/invoicelens-services";
async function values(name: string) {
  return Object.fromEntries(
    (await readFile(dir + "/" + name + ".env", "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
}
const children: ChildProcess[] = [];
const base: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  NODE_ENV: production ? "production" : "development",
};
async function start() {
  const names = ["extraction", "decision", "workflow"];
  for (const name of names) {
    const env = { ...base, ...(await values(name)) };
    const child = spawn(
      process.execPath,
      production
        ? [`services/${name}/dist/services/${name}/src/server.js`]
        : ["--import", "tsx", `services/${name}/src/server.ts`],
      { cwd: process.cwd(), env, stdio: "inherit" },
    );
    children.push(child);
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    if (child.exitCode !== null)
      throw Error(name + " service exited with " + child.exitCode);
  }
  const gateway = await values("gateway");
  const merged = {
    ...process.env,
    ...gateway,
    ...(production ? { INVOICELENS_DIST_DIR: ".next-production" } : {}),
    WORKSPACE_URL:
      gateway.APP_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3000",
  };
  const next = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      production ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      production ? "3003" : "3000",
    ],
    { cwd: process.cwd(), env: merged, stdio: "inherit" },
  );
  children.push(next);
  console.log(
    `InvoiceLens services and frontend starting at ${gateway.APP_URL ?? "http://127.0.0.1:3000"}`,
  );
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1200);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  await start();
  await new Promise<void>((resolve, reject) => {
    for (const c of children)
      c.once("exit", (code) => {
        if (!stopping) {
          if (!process.exitCode) process.exitCode = code ?? 1;
          reject(Error("A service stopped"));
        }
      });
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Application startup failed",
  );
  stop(1);
  await new Promise((resolve) => setTimeout(resolve, 1300));
}
