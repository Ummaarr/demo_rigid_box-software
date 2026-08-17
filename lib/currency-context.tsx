"use client";

// Makes the signed-in user's money dressing available to client components
// without threading a prop through every screen.
//
// The value is resolved ONCE on the server (app/(app)/layout.tsx, from the
// session) and handed down — client components never look up a currency
// themselves, so there is no way for a lead's rate card and the figures on
// screen to disagree about which market they are in.
//
// undefined = "use the deployment-wide BRAND dressing", which is what
// admin/staff get. formatMoney() already treats a missing format that way, so
// their rendering is byte-identical to before multi-currency existed.

import { createContext, useContext, useMemo } from "react";

import { formatMoney, type MoneyFormat } from "@/lib/currency";
import type { CurrencyCode } from "@/types";

/** What the provider carries: the dressing plus which market it belongs to. */
export interface CurrencyContextValue extends MoneyFormat {
  code: CurrencyCode;
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export function CurrencyProvider({
  value,
  children,
}: {
  value?: CurrencyContextValue;
  children: React.ReactNode;
}) {
  // Rebuilt only when the market actually changes — which in practice is
  // never within a session, since a trial's currency is fixed at first login.
  const { code, symbol, locale } = value ?? {};
  const memo = useMemo(
    () => (code && symbol && locale ? { code, symbol, locale } : undefined),
    [code, symbol, locale],
  );
  return <CurrencyContext.Provider value={memo}>{children}</CurrencyContext.Provider>;
}

/** The raw dressing, for the few places that need the symbol on its own. */
export function useMoneyFormat(): MoneyFormat | undefined {
  const ctx = useContext(CurrencyContext);
  return useMemo(
    () => (ctx ? { symbol: ctx.symbol, locale: ctx.locale } : undefined),
    [ctx],
  );
}

/**
 * Which market this session prices in.
 *
 * Admin/staff have no per-user currency — the deployment's own card is the INR
 * master (BRAND merely re-skins it), so they resolve to "INR" too. That makes
 * this safe to branch tax rules on without special-casing role.
 */
export function useCurrencyCode(): CurrencyCode {
  return useContext(CurrencyContext)?.code ?? "INR";
}

/**
 * Drop-in replacement for importing formatMoney directly: same signature,
 * but bound to this session's market.
 */
export function useMoneyFormatter(): (n: number, decimals?: number) => string {
  const fmt = useMoneyFormat();
  return useMemo(() => (n: number, decimals = 2) => formatMoney(n, decimals, fmt), [fmt]);
}
