"use client";
import { useCallback, useEffect, useState } from "react";
import { PageTitle } from "@/components/invoice-ui/ui";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
};
export default function UserAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const result = await fetch("/api/admin/users", { cache: "no-store" });
    if (result.ok) setUsers((await result.json()) as UserRow[]);
    else setMessage("Could not load accounts.");
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function create(data: FormData) {
    setBusy(true);
    setMessage("");
    const result = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        role: data.get("role"),
      }),
    });
    setBusy(false);
    if (!result.ok)
      setMessage("Account was not created. Check the fields and try again.");
    else {
      setMessage("Account created.");
      await reload();
    }
  }
  async function setRole(userId: string, role: string) {
    setBusy(true);
    const result = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "role", userId, role }),
    });
    setBusy(false);
    if (!result.ok) setMessage("Role was not changed.");
    else {
      setMessage("Role updated.");
      await reload();
    }
  }
  async function recover(data: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "password",
          userId: data.get("userId"),
          password: data.get("password"),
          reason: data.get("reason"),
        }),
      });
      if (!result.ok)
        throw new Error(
          "Recovery failed. You cannot reset your own account here.",
        );
      setMessage(
        "Password replaced and all of this user's sessions revoked. Deliver the password through your approved secure channel.",
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleUser(user: UserRow) {
    setBusy(true);
    const result = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: user.banned ? "enable" : "disable",
        userId: user.id,
      }),
    });
    setBusy(false);
    if (!result.ok) setMessage("Account status was not changed.");
    else {
      setMessage(
        user.banned
          ? "Account enabled."
          : "Account disabled; active sessions revoked.",
      );
      await reload();
    }
  }
  return (
    <section className="page-content">
      <PageTitle
        title="Workspace accounts"
        description="Create accounts, assign least privilege, and revoke access when someone leaves."
      />
      <form action={create} className="card grid gap-3 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Create account</h2>
        <label className="text-sm">
          Name
          <input
            required
            name="name"
            className="mt-1 w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Email
          <input
            required
            name="email"
            type="email"
            className="mt-1 w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Temporary password
          <input
            required
            name="password"
            type="password"
            minLength={14}
            className="mt-1 w-full rounded-lg border p-2"
          />
        </label>
        <label className="text-sm">
          Role
          <select name="role" className="mt-1 w-full rounded-lg border p-2">
            <option value="viewer">Viewer</option>
            <option value="reviewer">Reviewer</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <p className="text-xs text-slate-600 md:col-span-2">
          Deliver the temporary password through your approved secure channel
          and have the user change it after sign-in.
        </p>
        <button disabled={busy} className="button md:col-span-2">
          Create account
        </button>
      </form>
      <form action={recover} className="card grid gap-3 p-5 mt-5">
        <h2>Recover an account</h2>
        <p>
          Confirm the user’s identity through your company’s approved process
          before resetting access. Recovery is audited.
        </p>
        <label>
          Account
          <select name="userId" required>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={14}
            maxLength={128}
          />
        </label>
        <label>
          Identity-verification reason
          <textarea name="reason" required minLength={10} maxLength={1000} />
        </label>
        <button className="button" disabled={busy}>
          Reset password & revoke sessions
        </button>
      </form>
      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
      <div className="card mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.name}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <select
                    aria-label={`Role for ${u.email}`}
                    disabled={busy}
                    value={u.role.split(",")[0]}
                    onChange={(e) => void setRole(u.id, e.target.value)}
                    className="rounded border p-1"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="admin">Administrator</option>
                  </select>
                </td>
                <td className="p-3">
                  <button
                    disabled={busy}
                    onClick={() => void toggleUser(u)}
                    className="button button-secondary"
                  >
                    {u.banned ? "Enable" : "Disable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
