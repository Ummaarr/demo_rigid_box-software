"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InlineNotice } from "@/components/ui/inline-notice";
import { useShake } from "@/hooks/use-shake";

export function StaffForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { ref: formRef, shake } = useShake<HTMLFormElement>();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, password, role }),
      });
      const data = (await res.json()) as { error?: string; email?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to create the account.");
        shake();
        return;
      }

      setSuccess(`Created ${data.email}. They can sign in now.`);
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("staff");
      router.refresh();
      onSuccess?.();
    } catch {
      setError("Network error. Please try again.");
      shake();
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="t-shake space-y-4">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="staff-name">Full name</Label>
          <Input
            id="staff-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-email">Email</Label>
          <Input
            id="staff-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-password">Temporary password</Label>
          <Input
            id="staff-password"
            type="text"
            autoComplete="off"
            placeholder="Min. 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-role">Role</Label>
          <NativeSelect
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </div>
      </div>

      <InlineNotice kind="error">{error}</InlineNotice>
      <InlineNotice kind="success">{success}</InlineNotice>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
