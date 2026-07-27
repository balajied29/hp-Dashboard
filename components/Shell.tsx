"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearToken, getToken, setToken, VENUES } from "@/lib/api";

/**
 * App shell: gates on the staff passphrase, then holds the selected venue.
 *
 * Venue lives here rather than in each page so switching between Omara and
 * Noya keeps you on the screen you were already looking at.
 */

type Ctx = { venue: string; setVenue: (v: string) => void };
const VenueCtx = createContext<Ctx>({ venue: "omara", setVenue: () => {} });
export const useVenue = () => useContext(VenueCtx);

const NAV = [
  { href: "/", label: "Reservations" },
  { href: "/menu", label: "Menu" },
  { href: "/events", label: "Events" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "out" | "in">("checking");
  const [venue, setVenueState] = useState("omara");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = usePathname();

  // Remember the venue across reloads — staff usually work one venue at a time.
  useEffect(() => {
    const saved = localStorage.getItem("palacio_venue");
    if (saved) setVenueState(saved);
    if (!getToken()) {
      setState("out");
      return;
    }
    api
      .check()
      .then(() => setState("in"))
      .catch(() => setState("out"));
  }, []);

  const setVenue = useCallback((v: string) => {
    setVenueState(v);
    localStorage.setItem("palacio_venue", v);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(password);
      setToken(token);
      setPassword("");
      setState("in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") {
    return <div className="boot">Checking session…</div>;
  }

  if (state === "out") {
    return (
      <div className="login">
        <form onSubmit={submit} className="login__card">
          <p className="brand">Hotel Palacio</p>
          <h1>Staff dashboard</h1>
          <p className="muted">Omara and Noya, in one place.</p>
          <label>
            Passphrase
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <VenueCtx.Provider value={{ venue, setVenue }}>
      <div className="shell">
        <header className="bar">
          <div className="bar__left">
            <span className="brand">Hotel Palacio</span>
            <nav>
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={path === n.href ? "is-active" : ""}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="bar__right">
            <div className="venue-switch" role="tablist" aria-label="Venue">
              {VENUES.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={venue === v.id}
                  className={venue === v.id ? "is-active" : ""}
                  onClick={() => setVenue(v.id)}
                >
                  {v.name}
                </button>
              ))}
            </div>
            <button
              className="ghost"
              onClick={() => {
                clearToken();
                setState("out");
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </VenueCtx.Provider>
  );
}
