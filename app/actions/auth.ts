"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/db/server";

export type LoginState = { error: string } | undefined;

/**
 * Server Action for email/password login. Used by the login form via
 * useActionState. On success it redirects to /dashboard; on failure it returns
 * an error string for the form to display.
 *
 * There is no public signup — the Admin creates users in the Supabase
 * dashboard and assigns their role in the profiles table.
 */
export async function signIn(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  // Outside the error branch: redirect() throws internally, so it must not be
  // wrapped by error handling above.
  redirect("/dashboard");
}

/** Server Action for logout. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
