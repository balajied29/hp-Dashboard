"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Category, type Item } from "@/lib/api";
import { useVenue } from "@/components/Shell";

/**
 * Menu editor.
 *
 * Fields save on blur rather than behind a Save button — staff edit one price
 * at a time and a modal for each would be friction. Availability toggles
 * immediately, because "we've run out" is the most urgent thing this screen
 * does.
 */
export default function MenuPage() {
  const { venue } = useVenue();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCats(await api.menu(venue));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [venue]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (item: Item, changes: Partial<Item>) => {
    setSaving(item.id);
    // Reflect it locally first so the field doesn't flicker back while saving.
    setCats(
      (cs) =>
        cs?.map((c) => ({
          ...c,
          items: c.items.map((i) => (i.id === item.id ? { ...i, ...changes } : i)),
        })) ?? null
    );
    try {
      await api.saveItem(item.id, changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      void load();
    } finally {
      setSaving(null);
    }
  };

  const addCategory = async () => {
    const label = prompt("Name of the new section?");
    if (!label?.trim()) return;
    await api.addCategory(venue, label.trim());
    void load();
  };

  const addItem = async (categoryId: string) => {
    const name = prompt("Name of the new item?");
    if (!name?.trim()) return;
    await api.addItem(venue, categoryId, name.trim());
    void load();
  };

  const removeItem = async (item: Item) => {
    if (!confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    await api.deleteItem(item.id);
    void load();
  };

  const removeCategory = async (c: Category) => {
    if (
      !confirm(
        `Delete the “${c.label}” section and its ${c.items.length} item(s)? This cannot be undone.`
      )
    )
      return;
    await api.deleteCategory(c.id);
    void load();
  };

  return (
    <>
      <header className="head">
        <div>
          <p className="eyebrow">Menu</p>
          <h1>What the site is serving</h1>
          <p className="muted small">
            Edits are live. Turning an item off hides it from the site straight
            away.
          </p>
        </div>
        <button className="primary" onClick={addCategory}>
          Add section
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {!cats && <p className="muted">Loading…</p>}
      {cats && cats.length === 0 && (
        <p className="empty">No sections yet. Add one to get started.</p>
      )}

      {cats?.map((c) => (
        <section key={c.id} className="group">
          <div className="group__head">
            <input
              className="group__title"
              defaultValue={c.label}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== c.label) {
                  void api.renameCategory(c.id, e.target.value.trim()).then(load);
                }
              }}
            />
            <div className="group__actions">
              <button className="ghost" onClick={() => addItem(c.id)}>
                Add item
              </button>
              <button className="danger" onClick={() => removeCategory(c)}>
                Delete section
              </button>
            </div>
          </div>

          {c.items.length === 0 && <p className="muted small">Nothing in this section.</p>}

          {c.items.map((item) => (
            <div key={item.id} className={`row ${item.available ? "" : "is-off"}`}>
              <input
                className="row__name"
                defaultValue={item.name}
                onBlur={(e) =>
                  e.target.value.trim() !== item.name &&
                  patch(item, { name: e.target.value.trim() })
                }
              />
              <input
                className="row__price"
                type="number"
                min={0}
                placeholder="—"
                defaultValue={item.price ?? ""}
                onBlur={(e) =>
                  patch(item, {
                    // Empty means market price, which is not the same as zero.
                    price: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <input
                className="row__ing"
                placeholder="Ingredients, comma separated"
                defaultValue={item.ingredients.join(", ")}
                onBlur={(e) =>
                  patch(item, {
                    ingredients: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
              <label className="toggle" title="Available on the site">
                <input
                  type="checkbox"
                  checked={item.available}
                  onChange={(e) => patch(item, { available: e.target.checked })}
                />
                <span>{item.available ? "On" : "86'd"}</span>
              </label>
              <button
                className="danger small"
                onClick={() => removeItem(item)}
                aria-label={`Delete ${item.name}`}
              >
                ✕
              </button>
              {saving === item.id && <span className="saving">saving…</span>}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
