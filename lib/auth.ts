import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Access control.
 *
 * A shared passphrase, exchanged for a signed cookie. Deliberately modest:
 * this guards a small back-office for one venue group, and per-user accounts
 * would be scaffolding nobody asked for yet.
 *
 * What it does do properly: the passphrase is never stored in the cookie, the
 * cookie is HMAC-signed with a server secret so it cannot be forged, it is
 * httpOnly + sameSite so scripts and other sites cannot read it, and the
 * comparison is timing-safe.
 *
 * Set DASHBOARD_PASSWORD and DASHBOARD_SECRET before deploying. It refuses to
 * authenticate at all if they are missing, rather than falling back to a
 * default that would ship as a public door.
 */

const COOKIE = "palacio_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret(): string | null {
  const s = process.env.DASHBOARD_SECRET;
  return s && s.length >= 16 ? s : null;
}

function sign(value: string): string {
  const key = secret();
  if (!key) throw new Error("DASHBOARD_SECRET is not set");
  return createHmac("sha256", key).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function configured(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD) && Boolean(secret());
}

export async function isAuthed(): Promise<boolean> {
  if (!configured()) return false;
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return false;
  const [issued, mac] = raw.split(".");
  if (!issued || !mac) return false;
  // Reject anything past its own stated lifetime, even with a valid signature.
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return false;
  try {
    return safeEqual(mac, sign(issued));
  } catch {
    return false;
  }
}

export async function signIn(password: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || !secret()) return false;
  if (!safeEqual(password, expected)) return false;

  const issued = String(Date.now());
  const jar = await cookies();
  jar.set(COOKIE, `${issued}.${sign(issued)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return true;
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * The sites authenticate to the write endpoint with a separate token, so a
 * leaked site key never grants access to the dashboard UI.
 */
export function siteTokenValid(token: string | null): boolean {
  const expected = process.env.SITE_API_TOKEN;
  if (!expected || !token) return false;
  return safeEqual(token, expected);
}
