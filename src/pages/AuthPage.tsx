// Sign in, or create an account (then ask to join a team and wait for approval).
import { useState, type FormEvent } from "react";
import { signIn, signUp } from "../lib/store.ts";
import { Brand } from "../App.tsx";

export function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "up" && password.length < 8) { setError("Use at least 8 characters for the password."); return; }
    setBusy(true);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else if (await signUp(name.trim(), email.trim(), password)) setCheckEmail(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        {checkEmail ? (
          <>
            <h1>Check your email</h1>
            <p className="muted">We sent a link to <b>{email}</b>. Open it to confirm your account, then sign in here.</p>
            <button className="btn quiet" onClick={() => { setCheckEmail(false); setMode("in"); }}>Back to sign in</button>
          </>
        ) : (
          <>
            <h1>{mode === "in" ? "Sign in" : "Create an account"}</h1>
            <p className="muted">{mode === "in"
              ? "One shared lunch list a day for your team, from places near you."
              : "After you sign up, ask to join your team. You get in once an admin approves."}</p>
            <div className="seg" role="tablist" aria-label="Sign in or create an account">
              <button role="tab" aria-selected={mode === "in"} onClick={() => { setMode("in"); setError(""); }}>Sign in</button>
              <button role="tab" aria-selected={mode === "up"} onClick={() => { setMode("up"); setError(""); }}>Create account</button>
            </div>
            <form onSubmit={submit} className="auth-form">
              {mode === "up" && (
                <div className="field"><label htmlFor="name">Your name</label>
                  <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" placeholder="As your team knows you" /></div>
              )}
              <div className="field"><label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
              <div className="field"><label htmlFor="password">Password</label>
                <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={mode === "up" ? 8 : undefined} />
                {mode === "up" && <span className="hint">At least 8 characters.</span>}</div>
              {error && <div className="alert err" role="alert">{error}</div>}
              <button className="btn wide" disabled={busy}>{busy ? "One moment" : mode === "in" ? "Sign in" : "Create account"}</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
