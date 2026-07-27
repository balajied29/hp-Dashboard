"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Reservation } from "@/lib/api";
import { useVenue } from "@/components/Shell";

const FILTERS = [
  { id: "new", label: "New" },
  { id: "confirmed", label: "Confirmed" },
  { id: "declined", label: "Declined" },
  { id: "all", label: "All" },
];

function when(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReservationsPage() {
  const { venue } = useVenue();
  const [status, setStatus] = useState("new");
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.reservations(venue, status));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [venue, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Bookings arrive while the page is open, so poll rather than make staff refresh.
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (id: string, next: "confirmed" | "declined") => {
    // Optimistic: the row updates immediately, then reconciles with the server.
    setRows((r) => r?.map((x) => (x.id === id ? { ...x, status: next } : x)) ?? null);
    try {
      await api.setReservation(id, { status: next });
    } finally {
      void load();
    }
  };

  const saveNote = async (id: string, note: string) => {
    try {
      await api.setReservation(id, { note });
    } catch {
      /* field keeps what was typed; the next load reconciles */
    }
  };

  return (
    <>
      <header className="head">
        <div>
          <p className="eyebrow">Reservations</p>
          <h1>Requests from the site</h1>
        </div>
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={status === f.id ? "is-active" : ""}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!rows && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="empty">
          Nothing here yet. Requests submitted on the {venue} site land in this
          list as they arrive.
        </p>
      )}

      <div className="cards">
        {rows?.map((r) => (
          <article key={r.id} className="card">
            <div className="card__top">
              <div>
                <h2>{r.name}</h2>
                <p className="muted small">
                  {when(r.createdAt)} · {r.venueId}
                </p>
              </div>
              <span className={`pill pill--${r.status}`}>{r.status}</span>
            </div>

            <dl className="facts">
              {r.partySize ? (
                <div>
                  <dt>Party</dt>
                  <dd>{r.partySize}</dd>
                </div>
              ) : null}
              {r.wantedFor ? (
                <div>
                  <dt>Wanted for</dt>
                  <dd>{when(r.wantedFor)}</dd>
                </div>
              ) : null}
              {r.occasion ? (
                <div>
                  <dt>Occasion</dt>
                  <dd>{r.occasion}</dd>
                </div>
              ) : null}
              {r.email ? (
                <div>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${r.email}`}>{r.email}</a>
                  </dd>
                </div>
              ) : null}
              {r.phone ? (
                <div>
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${r.phone}`}>{r.phone}</a>
                  </dd>
                </div>
              ) : null}
            </dl>

            {r.message ? <p className="message">{r.message}</p> : null}

            <div className="card__foot">
              <input
                placeholder="Staff note — never shown to the guest"
                defaultValue={r.note ?? ""}
                onBlur={(e) => saveNote(r.id, e.target.value)}
              />
              {r.status !== "confirmed" && (
                <button className="primary" onClick={() => act(r.id, "confirmed")}>
                  Confirm
                </button>
              )}
              {r.status !== "declined" && (
                <button className="ghost" onClick={() => act(r.id, "declined")}>
                  Decline
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
