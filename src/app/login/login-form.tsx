"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { magicLinkAction, signInAction, signUpAction, type AuthState } from "./actions";

type Mode = "signin" | "signup" | "magic";

export function LoginForm({ initialError, next }: { initialError?: string; next: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [signInState, signIn, signInPending] = useActionState<AuthState, FormData>(signInAction, {});
  const [signUpState, signUp, signUpPending] = useActionState<AuthState, FormData>(signUpAction, {});
  const [magicState, magic, magicPending] = useActionState<AuthState, FormData>(magicLinkAction, {});

  const state = mode === "signin" ? signInState : mode === "signup" ? signUpState : magicState;
  const pending = signInPending || signUpPending || magicPending;
  const action = mode === "signin" ? signIn : mode === "signup" ? signUp : magic;
  const error = state.error ?? (mode === "signin" ? initialError : undefined);
  const lastEmail = signInState.email ?? signUpState.email ?? magicState.email ?? "";

  return (
    <div className="bg-card rounded-xl border p-5 shadow-xs">
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mb-4">
        <TabsList className="w-full">
          <TabsTrigger value="signin">Sign in</TabsTrigger>
          <TabsTrigger value="signup">Create account</TabsTrigger>
          <TabsTrigger value="magic">Magic link</TabsTrigger>
        </TabsList>
      </Tabs>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={lastEmail}
            placeholder="you@example.com"
          />
        </div>
        {mode !== "magic" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            We&apos;ll email you a one-time sign-in link. No password needed.
          </p>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {state.message ? (
          <Alert variant="success">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" disabled={pending} className="mt-1 w-full">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send magic link"}
        </Button>
      </form>
    </div>
  );
}
