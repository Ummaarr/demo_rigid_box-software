"use client";

// Create OR edit a client. With `initial` set the form pre-fills and submits
// PUT /api/clients/[id]; otherwise it POSTs a new client. Rendered inside the
// add/edit sheets on the clients page.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { InlineNotice } from "@/components/ui/inline-notice";
import { useShake } from "@/hooks/use-shake";
import type { ClientRow } from "@/lib/db/clients-db";

export function ClientForm({
  initial,
  onSuccess,
}: {
  /** When present the form edits this client instead of creating one. */
  initial?: ClientRow;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const isEdit = initial !== undefined;
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    contact_person: initial?.contact_person ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    address: initial?.address ?? "",
  });
  // Lead vs customer (client 4-Jul). New contacts default to Lead.
  const [type, setType] = useState<"lead" | "customer">(initial?.type ?? "lead");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const { ref: formRef, shake } = useShake<HTMLFormElement>();

  function bind(k: keyof typeof form) {
    return {
      value: form[k],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((prev) => ({ ...prev, [k]: e.target.value })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Company name is required.");
      shake();
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    const r = await fetch(isEdit ? `/api/clients/${initial.id}` : "/api/clients", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, type }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? (isEdit ? "Failed to save changes." : "Failed to create client."));
      shake();
      return;
    }
    setSuccess(true);
    if (!isEdit) {
      setForm({ name: "", contact_person: "", phone: "", email: "", address: "" });
      setType("lead");
    }
    router.refresh();
    onSuccess?.();
  }

  return (
    <form ref={formRef} onSubmit={(e) => void handleSubmit(e)} className="t-shake grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="c-name">Company name *</Label>
        <Input id="c-name" placeholder="Acme Packaging..." {...bind("name")} />
      </div>
      <div className="grid gap-1">
        <Label>Type</Label>
        <Segmented
          value={type}
          onValueChange={setType}
          options={[
            { value: "lead", label: "Lead" },
            { value: "customer", label: "Customer" },
          ]}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="c-contact">Contact person</Label>
        <Input id="c-contact" placeholder="Full name" {...bind("contact_person")} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" placeholder="+91 98xxx" {...bind("phone")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="c-email">Email</Label>
          <Input
            id="c-email"
            type="email"
            placeholder="name@co.in"
            {...bind("email")}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="c-address">Address</Label>
        <Input
          id="c-address"
          placeholder="City, state"
          {...bind("address")}
        />
      </div>
      <InlineNotice kind="error">{error}</InlineNotice>
      <InlineNotice kind="success">
        {success && !isEdit ? "Client added." : null}
      </InlineNotice>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving…" : isEdit ? "Save changes" : "Add client"}
      </Button>
    </form>
  );
}
