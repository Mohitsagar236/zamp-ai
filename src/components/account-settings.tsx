"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { PageTitle } from "./invoice-ui/ui";

export default function AccountSettings() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function change(data: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.changePassword({
        currentPassword: String(data.get("currentPassword") ?? ""),
        newPassword: String(data.get("newPassword") ?? ""),
        revokeOtherSessions: true,
      });
      setMessage(
        result.error
          ? "Password was not changed. Check your current password and try again."
          : "Password changed. Other sessions have been revoked.",
      );
    } catch {
      setMessage("Could not change the password. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-stack">
      <PageTitle
        title="My account"
        description="Change your password and revoke your other sessions."
      />
      <form action={change} className="panel content-stack">
        <label className="form-field">
          Current password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label className="form-field">
          New password
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={14}
            maxLength={128}
          />
        </label>
        <button className="button primary" disabled={busy}>
          Change password
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
