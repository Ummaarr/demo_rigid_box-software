"use client";

import { useActionState, useEffect, useState } from "react";
import { AtSignIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";

import { signIn, type LoginState } from "@/app/actions/auth";
import { useShake } from "@/hooks/use-shake";
import { BrandWordmark } from "@/components/brand-wordmark";
import { FloatingPaths } from "@/components/floating-paths";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/lib/brand";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    signIn,
    undefined,
  );
  const [showPassword, setShowPassword] = useState(false);
  const { ref: formRef, shake } = useShake<HTMLFormElement>();

  // Shake the form when the server action returns an error (wrong credentials).
  useEffect(() => {
    if (state?.error) shake();
  }, [state, shake]);

  return (
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2">
      {/* Left: brand panel with the signature floating-paths motif (monochrome navy). */}
      <div className="relative hidden h-full flex-col border-r bg-secondary p-10 lg:flex">
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-background" />
        <BrandWordmark width={190} className="relative z-10" />

        <div className="relative z-10 mt-auto max-w-sm">
          <p className="text-lg leading-relaxed text-foreground">
            Rigid box cost estimation — fast, consistent quotes from raw material
            to final price.
          </p>
          {/* Spaces -> U+00A0 so the tagline never wraps mid-phrase. */}
          <p className="mt-3 font-mono text-sm tracking-wide text-muted-foreground">
            {BRAND.tagline.replace(/ /g, " ")}
          </p>
        </div>

        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      {/* Right: sign-in form. */}
      <div className="relative flex min-h-screen flex-col justify-center px-8">
        <div
          aria-hidden
          className="absolute inset-0 isolate -z-10 opacity-60 contain-strict"
        >
          <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,--theme(--color-foreground/.06)_0,hsla(0,0%,55%,.02)_50%,--theme(--color-foreground/.01)_80%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,--theme(--color-foreground/.04)_0,--theme(--color-foreground/.01)_80%,transparent_100%)] [translate:5%_-50%]" />
        </div>

        <div className="mx-auto w-full space-y-6 sm:w-sm">
          <BrandWordmark width={160} className="lg:hidden" />

          <div className="flex flex-col space-y-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Sign in
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter your credentials to access the estimator.
            </p>
          </div>

          <form ref={formRef} action={action} className="t-shake space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <InputGroup>
                <InputGroupInput
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={BRAND.emailPlaceholder}
                  required
                />
                <InputGroupAddon align="inline-start">
                  <AtSignIcon />
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <InputGroup>
                <InputGroupInput
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
                <InputGroupAddon align="inline-start">
                  <KeyRoundIcon />
                </InputGroupAddon>
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            {state?.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <Button type="submit" disabled={pending} className="w-full" size="lg">
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            Internal tool — accounts are provisioned by your administrator.
          </p>
        </div>
      </div>
    </main>
  );
}
