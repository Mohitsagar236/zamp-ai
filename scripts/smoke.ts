import { readFile, writeFile } from "node:fs/promises";
import { config } from "../src/lib/config";
const base = config.APP_URL;
const auth: Record<string, string> =
  config.AUTH_MODE === "basic"
    ? {
        Authorization:
          "Basic " +
          Buffer.from(
            config.WORKSPACE_USER + ":" + config.WORKSPACE_PASSWORD,
          ).toString("base64"),
      }
    : {};
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(base + "/api/" + path, {
    ...options,
    headers: { Origin: base, ...auth, ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
async function scenario(file: string) {
  const form = new FormData();
  form.set(
    "file",
    new File([await readFile("public/samples/" + file)], file, {
      type: "application/pdf",
    }),
  );
  const { id } = await request("invoices", { method: "POST", body: form });
  for (let i = 0; i < 150; i++) {
    const r = await request("invoices/" + id);
    if (r.status === "failed") throw Error(file + ": " + r.state.error);
    if (r.status === "completed") return r;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(file + ": worker timeout");
}
const results = [];
for (const file of [
  "happy-path.pdf",
  "duplicate-renamed.pdf",
  "split-overbalance.pdf",
  "scan-missing-total.pdf",
  "ambiguous-po.pdf",
]) {
  const r = await scenario(file);
  const result = {
    file,
    id: r.id,
    decision: r.state.evaluation.decision,
    provider: r.state.extraction.provider,
    total: r.state.fields.total,
    candidates: r.state.evaluation.candidates,
    excess: r.state.evaluation.balance?.excess,
  };
  console.log(JSON.stringify(result));
  results.push(result);
}
await writeFile(".data/smoke-results.json", JSON.stringify(results, null, 2));
