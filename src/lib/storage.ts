import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
export class InputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function validateUpload(name: string, data: Uint8Array) {
  if (!name.toLowerCase().endsWith(".pdf"))
    throw new InputError("Choose a PDF file.");
  if (data.length > config.MAX_FILE_MB * 1024 * 1024)
    throw new InputError(`PDF must be at most ${config.MAX_FILE_MB} MB.`, 413);
  if (
    data.length < 12 ||
    Buffer.from(data.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new InputError("File content is not a PDF.");
}
export interface PrivateStorage {
  put(data: Uint8Array): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
function path(key: string) {
  if (!/^[a-f0-9-]{36}\.pdf$/.test(key))
    throw new InputError("Invalid document identifier");
  return join(resolve(config.STORAGE_DIR), key);
}
export const storage: PrivateStorage = {
  async put(data) {
    await mkdir(resolve(config.STORAGE_DIR), { recursive: true, mode: 0o700 });
    const key = randomUUID() + ".pdf";
    await writeFile(path(key), data, { flag: "wx", mode: 0o600 });
    return key;
  },
  get: (key) => readFile(path(key)),
  remove: (key) => unlink(path(key)),
};
export const storagePath = path;
