import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./http.js";
function file(key: string) {
  if (!/^[0-9a-f-]{36}\.pdf$/.test(key))
    throw new HttpError(400, "Invalid document key");
  return join(resolve(config.STORAGE_DIR), key);
}
export const storage = {
  async put(data: Uint8Array) {
    await mkdir(resolve(config.STORAGE_DIR), { recursive: true, mode: 0o700 });
    const key = randomUUID() + ".pdf";
    await writeFile(file(key), data, { flag: "wx", mode: 0o600 });
    return key;
  },
  get: (key: string) => readFile(file(key)),
  remove: (key: string) => unlink(file(key)),
};
export function validateUpload(name: string, b: Uint8Array) {
  if (!name.toLowerCase().endsWith(".pdf"))
    throw new HttpError(400, "Choose a PDF file.");
  if (b.length > config.MAX_FILE_MB * 1024 * 1024)
    throw new HttpError(413, "PDF exceeds the configured size limit.");
  if (b.length < 12 || Buffer.from(b.subarray(0, 5)).toString() !== "%PDF-")
    throw new HttpError(400, "File content is not a PDF.");
}
export const storagePath = file;
