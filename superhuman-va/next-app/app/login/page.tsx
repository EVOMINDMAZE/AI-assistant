"use client";

/**
 * app/login/page.tsx — Supabase Auth login page.
 *
 * Supports email + password, magic link, and OAuth. The form
 * below signs in with email + password. Toggle to magic link by
 * replacing the `signInWithPassword` call with `signInWithOtp`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Sparkles, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createBrowserSupabase } from "@/lib/supabase/client";

type Mode = "password" | "magic" | "signup";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("password");
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const sb = createBrowserSupabase();
      if (mode === "password" || mode === "signup") {
        const { error } =
          mode === "signup"
            ? await sb.auth.signUp({ email, password })
            : await sb.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        router.push("/chat");
        router.refresh();
      } else {
        const { error } = await sb.auth.signInWithOtp({ email });
        if (error) {
          setError(error.message);
          return;
        }
        setInfo("Check your email for the magic link.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Superhuman VA
          </CardTitle>
          <CardDescription>
            {mode === "magic" ? "We'll email you a magic link." : "Sign in to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-input px-3 py-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 bg-transparent text-sm outline-none"
                autoFocus
                required
              />
            </div>
            {mode !== "magic" && (
              <div className="flex items-center gap-2 rounded-md border border-input px-3 py-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (min 6 chars)"
                  className="flex-1 bg-transparent text-sm outline-none"
                  minLength={6}
                  required
                />
              </div>
            )}
            {error && <p className="text-xs text-rose-500">{error}</p>}
            {info && <p className="text-xs text-emerald-500">{info}</p>}
            <Button type="submit" disabled={busy || !email || (mode !== "magic" && !password)} className="w-full">
              {busy
                ? "Working…"
                : mode === "signup"
                ? "Create account"
                : mode === "magic"
                ? "Send magic link"
                : "Sign in"}
            </Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setMode(mode === "magic" ? "password" : "magic")}
              className="hover:underline"
            >
              {mode === "magic" ? "Use password" : "Use magic link"}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "signup" ? "password" : "signup")}
              className="flex items-center gap-1 hover:underline"
            >
              <KeyRound className="h-3 w-3" />
              {mode === "signup" ? "Have an account?" : "Create account"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
