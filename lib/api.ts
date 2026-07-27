"use client";

/**
 * Client for the Express API.
 *
 * The staff token lives in localStorage rather than a cookie because the API
 * is a separate origin and takes a Bearer header — that keeps the API free of
 * cookie/CORS credential handling. A 401 clears the token and bounces to the
 * login screen, so an expired session never leaves the UI in a broken state.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const KEY = "palacio_token";

export const getToken = () =>
  typeof window === "undefined" ? null : localStorage.getItem(KEY);
export const setToken = (t: string) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

export class Unauthorised extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) {
      // Surface the server's reason. Mapping every 401 to "session expired"
      // told staff their session had lapsed when they had simply mistyped the
      // passphrase.
      clearToken();
      throw new Unauthorised(body.error ?? "Session expired");
    }
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  login: (password: string) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  check: () => request<{ ok: true }>("/auth/check"),

  // Menu — `all=1` includes 86'd items, which only staff may see.
  menu: (venue: string) => request<Category[]>(`/${venue}/menu?all=1`),
  addCategory: (venue: string, label: string) =>
    request<{ id: string }>(`/${venue}/menu/categories`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  renameCategory: (id: string, label: string) =>
    request(`/menu/categories/${id}`, { method: "PATCH", body: JSON.stringify({ label }) }),
  deleteCategory: (id: string) => request(`/menu/categories/${id}`, { method: "DELETE" }),

  addItem: (venue: string, categoryId: string, name: string) =>
    request<{ id: string }>(`/${venue}/menu/items`, {
      method: "POST",
      body: JSON.stringify({ categoryId, name }),
    }),
  saveItem: (id: string, patch: Partial<Item>) =>
    request(`/menu/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteItem: (id: string) => request(`/menu/items/${id}`, { method: "DELETE" }),

  events: (venue: string) => request<EventItem[]>(`/${venue}/events?all=1`),
  addEvent: (venue: string, title: string) =>
    request<{ id: string }>(`/${venue}/events`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  saveEvent: (id: string, patch: Partial<EventItem>) =>
    request(`/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteEvent: (id: string) => request(`/events/${id}`, { method: "DELETE" }),

  reservations: (venue: string, status: string) =>
    request<Reservation[]>(`/reservations?venue=${venue}&status=${status}`),
  setReservation: (id: string, patch: { status?: string; note?: string }) =>
    request(`/reservations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /** Multipart, so no content-type header — the browser sets the boundary. */
  upload: async (file: File, venueId: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("venueId", venueId);
    const token = getToken();
    const res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      body: fd,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { error?: string }).error ?? "Upload failed");
    }
    return (await res.json()) as { url: string; publicId: string };
  },
};

// ---------- shapes ----------

export type Item = {
  id: string;
  name: string;
  price: number | null;
  ingredients: string[];
  tags?: string | null;
  glass?: string | null;
  garnish?: string | null;
  image?: string | null;
  imagePublicId?: string | null;
  available: boolean;
  position: number;
};

export type Category = { id: string; label: string; position: number; items: Item[] };

export type EventItem = {
  id: string;
  title: string;
  blurb: string;
  startsOn: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  published: boolean;
  position: number;
};

export type Reservation = {
  id: string;
  venueId: string;
  name: string;
  email: string | null;
  phone: string | null;
  partySize: number | null;
  wantedFor: string | null;
  occasion: string | null;
  message: string | null;
  status: "new" | "confirmed" | "declined";
  note: string | null;
  source: string;
  createdAt: string;
};

export const VENUES = [
  { id: "omara", name: "Omara" },
  { id: "noya", name: "Noya by NYX" },
];
