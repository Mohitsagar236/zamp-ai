import { createHmac, timingSafeEqual } from "node:crypto";

export type WorkspaceRole = "admin" | "reviewer" | "viewer";
export type WorkspacePrincipal = {
  sub: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  issuedAt: number;
  expiresAt: number;
};

export function signWorkspaceIdentity(
  principal: Omit<WorkspacePrincipal, "issuedAt" | "expiresAt">,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (secret.length < 32)
    throw new Error("Identity signing secret is too short");
  const payload = Buffer.from(
    JSON.stringify({ ...principal, issuedAt: now, expiresAt: now + 60 }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyWorkspaceIdentity(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): WorkspacePrincipal | null {
  if (secret.length < 32 || token.length > 4096) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as WorkspacePrincipal;
    if (
      !value.sub ||
      !value.email ||
      !value.name ||
      !["admin", "reviewer", "viewer"].includes(value.role) ||
      !Number.isInteger(value.issuedAt) ||
      !Number.isInteger(value.expiresAt) ||
      value.issuedAt > now + 5 ||
      value.expiresAt <= now ||
      value.expiresAt - value.issuedAt > 60
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
