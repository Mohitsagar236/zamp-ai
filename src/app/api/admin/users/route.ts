import { auth, authDb } from "@/lib/better-auth";
import { z } from "zod";
import { boundedBody } from "@/lib/request-body";

export const runtime = "nodejs";
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    email: z.string().email(),
    name: z.string().min(2).max(120),
    password: z.string().min(14).max(128),
    role: z.enum(["admin", "reviewer", "viewer"]),
  }),
  z.object({
    action: z.literal("role"),
    userId: z.string().min(1),
    role: z.enum(["admin", "reviewer", "viewer"]),
  }),
  z.object({ action: z.literal("disable"), userId: z.string().min(1) }),
  z.object({ action: z.literal("enable"), userId: z.string().min(1) }),
  z.object({
    action: z.literal("password"),
    userId: z.string().min(1),
    password: z.string().min(14).max(128),
    reason: z.string().trim().min(10).max(1000),
  }),
]);
async function administrator(request: Request) {
  if (request.method !== "GET") {
    const origin = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000");
    if (
      request.headers.get("origin") !== origin.origin ||
      request.headers.get("host") !== origin.host
    )
      return null;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (
    !session?.user ||
    (session.user as typeof session.user & { role?: string }).role !== "admin"
  )
    return null;
  return session.user.id;
}
export async function GET(request: Request) {
  const actor = await administrator(request);
  if (!actor)
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const users = await authDb.query(
    'SELECT id,name,email,role,banned FROM "user" ORDER BY email',
  );
  return Response.json(users.rows, {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  const actor = await administrator(request);
  if (!actor)
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  let parsed: z.infer<typeof inputSchema>;
  try {
    parsed = inputSchema.parse(
      JSON.parse(new TextDecoder().decode(await boundedBody(request, 16000))),
    );
  } catch {
    return Response.json(
      { error: "Invalid account request." },
      { status: 400 },
    );
  }
  if ("userId" in parsed && parsed.userId === actor)
    return Response.json(
      { error: "Administrators cannot change their own role or access." },
      { status: 409 },
    );
  const targetEmail = "email" in parsed ? parsed.email.toLowerCase() : null;
  const target = "userId" in parsed ? parsed.userId : null;
  const gate = await authDb.connect();
  try {
    await gate.query("SELECT pg_advisory_lock(716212)");
    if (target) {
      const current = await gate.query(
        'SELECT role,banned FROM "user" WHERE id=$1',
        [target],
      );
      if (!current.rowCount)
        return Response.json({ error: "Account not found." }, { status: 404 });
      const removingAdmin =
        current.rows[0].role === "admin" &&
        (parsed.action === "disable" ||
          (parsed.action === "role" && parsed.role !== "admin"));
      if (removingAdmin) {
        const admins = await gate.query(
          "SELECT count(*)::int AS count FROM \"user\" WHERE role='admin' AND banned=false",
        );
        if (admins.rows[0].count <= 1)
          return Response.json(
            {
              error:
                "The last active administrator cannot be removed or demoted.",
            },
            { status: 409 },
          );
      }
    }
    const audit = await gate.query(
      "INSERT INTO identity_audit(actor_id,target_user_id,action,data) VALUES($1,$2,$3,$4) RETURNING id",
      [
        actor,
        target,
        `account_${parsed.action}_requested`,
        JSON.stringify({
          email: targetEmail,
          userId: target,
          role: "role" in parsed ? parsed.role : undefined,
          reason: "reason" in parsed ? parsed.reason : undefined,
        }),
      ],
    );
    try {
      let userId = target;
      if (parsed.action === "create") {
        const created = await auth.api.createUser({
          body: {
            email: parsed.email,
            name: parsed.name,
            password: parsed.password,
            role: parsed.role,
          },
          headers: request.headers,
        });
        userId = created.user.id;
      } else if (parsed.action === "role") {
        await auth.api.setRole({
          body: { userId: parsed.userId, role: parsed.role },
          headers: request.headers,
        });
      } else if (parsed.action === "disable") {
        await auth.api.banUser({
          body: {
            userId: parsed.userId,
            banReason: "Disabled by workspace administrator",
          },
          headers: request.headers,
        });
      } else if (parsed.action === "password") {
        // Use the configured authentication hasher, then atomically replace the
        // credential, revoke sessions and complete the audit record.
        const context = await auth.$context;
        const hashed = await context.password.hash(parsed.password);
        await gate.query("BEGIN");
        const account = await gate.query(
          'UPDATE account SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\' RETURNING id',
          [parsed.userId, hashed],
        );
        if (!account.rowCount) throw new Error("Credential account not found");
        await gate.query('DELETE FROM session WHERE "userId"=$1', [
          parsed.userId,
        ]);
        await gate.query(
          "UPDATE identity_audit SET target_user_id=$2,action='account_password_completed' WHERE id=$1",
          [audit.rows[0].id, parsed.userId],
        );
        await gate.query("COMMIT");
        return Response.json({ ok: true });
      } else {
        await auth.api.unbanUser({
          body: { userId: parsed.userId },
          headers: request.headers,
        });
      }
      await gate.query(
        "UPDATE identity_audit SET target_user_id=$2,action=$3 WHERE id=$1",
        [audit.rows[0].id, userId, `account_${parsed.action}_completed`],
      );
      return Response.json(
        { ok: true },
        { status: parsed.action === "create" ? 201 : 200 },
      );
    } catch {
      await gate.query("ROLLBACK").catch(() => {});
      await gate.query("UPDATE identity_audit SET action=$2 WHERE id=$1", [
        audit.rows[0].id,
        `account_${parsed.action}_failed`,
      ]);
      return Response.json(
        { error: "Account change could not be completed." },
        { status: 400 },
      );
    }
  } finally {
    await gate.query("SELECT pg_advisory_unlock(716212)").catch(() => {});
    gate.release();
  }
}
