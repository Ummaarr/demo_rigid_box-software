// POST /api/trial/set-currency — a trial user picks the market they are
// evaluating from, on first login. Self-service like ack-rates: it only ever
// touches the CALLER's own profile and rate card, so no id is accepted from
// the client and no admin check is needed.
//
// This is where a trial's rate card is actually created. Account creation
// (POST /api/staff) deliberately leaves a trial with no rates at all, because
// the master card is four per-market template sets and the right one isn't
// known until this choice is made.
//
// The choice is ONE-WAY. Re-picking would have to re-home a card the lead may
// already have edited and every estimate priced against it, so — exactly like
// changing a trial's role — the answer is delete and re-create the account.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import {
  cloneRateCardForUser,
  deleteRateCardForUser,
  hasRateCardForUser,
} from "@/lib/db/clone-rate-card";
import { isCurrencyCode } from "@/lib/currency-meta";

interface SetCurrencyBody {
  currency?: string;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (session.role !== "trial") {
    return Response.json(
      { error: "Only trial accounts choose a market." },
      { status: 403 },
    );
  }
  if (session.trialCurrency) {
    return Response.json(
      { error: "Your market has already been set and cannot be changed." },
      { status: 409 },
    );
  }

  let body: SetCurrencyBody;
  try {
    body = (await request.json()) as SetCurrencyBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const currency = body.currency;
  if (!isCurrencyCode(currency)) {
    return Response.json({ error: "Unknown market." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency guard, same one account creation used to rely on: a retry
  // after a half-finished clone must not stack a second copy on top, which
  // would collide with this user's own partial unique indexes.
  if (await hasRateCardForUser(admin, session.userId)) {
    await deleteRateCardForUser(admin, session.userId);
  }

  try {
    await cloneRateCardForUser(admin, session.userId, currency);
  } catch (err) {
    // Leave no half-built card behind: the next attempt should start clean.
    await deleteRateCardForUser(admin, session.userId);
    console.error("POST /api/trial/set-currency clone failed:", err);
    return Response.json(
      { error: "Could not set up your rate card. Please try again." },
      { status: 500 },
    );
  }

  // Written LAST: trial_currency is what the layout reads to stop showing the
  // picker, so setting it before the clone succeeded would drop the lead into
  // an app with no rates.
  const { error } = await admin
    .from("profiles")
    .update({ trial_currency: currency })
    .eq("id", session.userId);

  if (error) {
    await deleteRateCardForUser(admin, session.userId);
    console.error("POST /api/trial/set-currency profile update failed:", error);
    return Response.json(
      { error: "Could not save your choice. Please try again." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, currency });
}
