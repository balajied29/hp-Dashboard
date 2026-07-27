"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventItem } from "@/lib/api";
import { useVenue } from "@/components/Shell";

/**
 * Events editor.
 *
 * An event with no date is an evergreen offering (private dining, guest
 * kitchens) rather than something happening on a particular night, so the date
 * field is optional throughout.
 */
export default function EventsPage() {
  const { venue } = useVenue();
  const [rows, setRows] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.events(venue));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [venue]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (e: EventItem, changes: Partial<EventItem>) => {
    setRows((rs) => rs?.map((r) => (r.id === e.id ? { ...r, ...changes } : r)) ?? null);
    try {
      await api.saveEvent(e.id, changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      void load();
    }
  };

  const add = async () => {
    const title = prompt("Title of the new event?");
    if (!title?.trim()) return;
    await api.addEvent(venue, title.trim());
    void load();
  };

  const remove = async (e: EventItem) => {
    if (!confirm(`Delete “${e.title}”? This cannot be undone.`)) return;
    await api.deleteEvent(e.id);
    void load();
  };

  return (
    <>
      <header className="head">
        <div>
          <p className="eyebrow">Events</p>
          <h1>What&apos;s on</h1>
          <p className="muted small">
            Leave the date empty for something always available, like private
            dining.
          </p>
        </div>
        <button className="primary" onClick={add}>
          Add event
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {!rows && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="empty">Nothing listed yet.</p>}

      <div className="cards">
        {rows?.map((e) => (
          <article key={e.id} className={`card ${e.published ? "" : "is-off"}`}>
            <div className="card__top">
              <input
                className="row__name"
                defaultValue={e.title}
                onBlur={(ev) =>
                  ev.target.value.trim() !== e.title &&
                  patch(e, { title: ev.target.value.trim() })
                }
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={e.published}
                  onChange={(ev) => patch(e, { published: ev.target.checked })}
                />
                <span>{e.published ? "Live" : "Hidden"}</span>
              </label>
            </div>

            <textarea
              rows={3}
              placeholder="Description"
              defaultValue={e.blurb}
              onBlur={(ev) => ev.target.value !== e.blurb && patch(e, { blurb: ev.target.value })}
            />

            <div className="grid3">
              <label>
                Date <span className="muted small">(optional)</span>
                <input
                  type="date"
                  defaultValue={e.startsOn ? e.startsOn.slice(0, 10) : ""}
                  onBlur={(ev) => patch(e, { startsOn: ev.target.value || null })}
                />
              </label>
              <label>
                Button label
                <input
                  placeholder="e.g. Enquire"
                  defaultValue={e.ctaLabel ?? ""}
                  onBlur={(ev) => patch(e, { ctaLabel: ev.target.value || null })}
                />
              </label>
              <label>
                Button link
                <input
                  placeholder="/location#reserve"
                  defaultValue={e.ctaHref ?? ""}
                  onBlur={(ev) => patch(e, { ctaHref: ev.target.value || null })}
                />
              </label>
            </div>

            <div className="card__foot">
              <button className="danger" onClick={() => remove(e)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
