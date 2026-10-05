import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { isSignupAllowed } from "./actions";
import { Wordmark } from "@/components/app/wordmark";

export const metadata: Metadata = { title: "Sign in · FRADY OS" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const allowSignup = await isSignupAllowed();
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1>
            <Wordmark size="lg" className="text-3xl" />
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">Your personal command center. Sign in to continue.</p>
        </div>
        <LoginForm initialError={error} next={next} allowSignup={allowSignup} />
      </div>
    </main>
  );
}
