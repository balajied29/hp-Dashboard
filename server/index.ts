import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  connectDb,
  EventDoc,
  MenuCategory,
  MenuItem,
  Reservation,
  RESERVATION_STATUSES,
  VENUE_IDS,
  type VenueId,
} from "./models.js";

/**
 * Hotel Palacio API.
 *
 * One service behind two sites and one dashboard. Two audiences, two levels of
 * trust:
 *
 *  - the sites read published content and post reservations. Read is open;
 *    posting is rate-limited but unauthenticated, because a booking form
 *    cannot carry a secret in the browser.
 *  - the dashboard reads everything, including unpublished and 86'd items, and
 *    writes. That requires the staff token.
 */

const app = express();
const PORT = Number(process.env.API_PORT ?? 4000);

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    // Only the two sites and the dashboard may call this from a browser.
    origin: (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3100,http://localhost:3200")
      .split(",")
      .map((s) => s.trim()),
    credentials: true,
  })
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ---------- auth ----------

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function sign(value: string) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) throw new Error("DASHBOARD_SECRET is not set");
  return createHmac("sha256", secret).update(value).digest("hex");
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** Token is `issuedAt.hmac` — stateless, expiring, and unforgeable. */
function issueToken() {
  const issued = String(Date.now());
  return `${issued}.${sign(issued)}`;
}

function tokenValid(token?: string | null) {
  if (!token) return false;
  const [issued, mac] = token.split(".");
  if (!issued || !mac) return false;
  if (Date.now() - Number(issued) > TOKEN_TTL_MS) return false;
  try {
    return safeEqual(mac, sign(issued));
  } catch {
    return false;
  }
}

function requireStaff(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!tokenValid(token)) {
    res.status(401).json({ error: "Not authorised" });
    return;
  }
  next();
}

app.post("/api/auth/login", (req, res) => {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || !process.env.DASHBOARD_SECRET) {
    // Fail closed. A missing password must never mean "let everyone in".
    res.status(500).json({ error: "Server auth is not configured" });
    return;
  }
  const supplied = String(req.body?.password ?? "");
  if (!safeEqual(supplied, expected)) {
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  res.json({ token: issueToken(), expiresIn: TOKEN_TTL_MS / 1000 });
});

app.get("/api/auth/check", requireStaff, (_req, res) => res.json({ ok: true }));

// ---------- helpers ----------

function venueOf(req: Request, res: Response): VenueId | null {
  const v = String(req.params.venueId ?? req.query.venue ?? "");
  if (!VENUE_IDS.includes(v as VenueId)) {
    res.status(400).json({ error: `venue must be one of ${VENUE_IDS.join(", ")}` });
    return null;
  }
  return v as VenueId;
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---------- menu ----------

/** Public read. Only published, available items unless staff asks otherwise. */
app.get(
  "/api/:venueId/menu",
  wrap(async (req, res) => {
    const venueId = venueOf(req, res);
    if (!venueId) return;
    const staff = tokenValid((req.header("authorization") ?? "").replace("Bearer ", ""));
    const wantAll = staff && req.query.all === "1";

    const categories = await MenuCategory.find({ venueId }).sort({ position: 1 }).lean();
    const items = await MenuItem.find({
      venueId,
      ...(wantAll ? {} : { available: true }),
    })
      .sort({ position: 1 })
      .lean();

    res.json(
      categories.map((c) => ({
        id: String(c._id),
        label: c.label,
        position: c.position,
        items: items
          .filter((i) => String(i.categoryId) === String(c._id))
          .map((i) => ({ ...i, id: String(i._id), _id: undefined })),
      }))
    );
  })
);

app.post(
  "/api/:venueId/menu/categories",
  requireStaff,
  wrap(async (req, res) => {
    const venueId = venueOf(req, res);
    if (!venueId) return;
    const count = await MenuCategory.countDocuments({ venueId });
    const cat = await MenuCategory.create({
      venueId,
      label: String(req.body?.label ?? "New section"),
      position: count,
    });
    res.status(201).json({ id: String(cat._id) });
  })
);

app.patch(
  "/api/menu/categories/:id",
  requireStaff,
  wrap(async (req, res) => {
    await MenuCategory.findByIdAndUpdate(req.params.id, {
      ...(req.body.label !== undefined ? { label: req.body.label } : {}),
      ...(req.body.position !== undefined ? { position: req.body.position } : {}),
    });
    res.json({ ok: true });
  })
);

app.delete(
  "/api/menu/categories/:id",
  requireStaff,
  wrap(async (req, res) => {
    // Removing a section must not orphan its dishes.
    await MenuItem.deleteMany({ categoryId: req.params.id });
    await MenuCategory.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

app.post(
  "/api/:venueId/menu/items",
  requireStaff,
  wrap(async (req, res) => {
    const venueId = venueOf(req, res);
    if (!venueId) return;
    const { categoryId, name } = req.body ?? {};
    if (!categoryId || !name) {
      res.status(400).json({ error: "categoryId and name are required" });
      return;
    }
    const count = await MenuItem.countDocuments({ categoryId });
    const item = await MenuItem.create({ ...req.body, venueId, position: count });
    res.status(201).json({ id: String(item._id) });
  })
);

app.patch(
  "/api/menu/items/:id",
  requireStaff,
  wrap(async (req, res) => {
    const allowed = [
      "name", "price", "ingredients", "tags", "glass", "garnish",
      "build", "taste", "image", "imagePublicId", "available", "position", "categoryId",
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in (req.body ?? {})) patch[k] = req.body[k];
    await MenuItem.findByIdAndUpdate(req.params.id, patch, { runValidators: true });
    res.json({ ok: true });
  })
);

app.delete(
  "/api/menu/items/:id",
  requireStaff,
  wrap(async (req, res) => {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

// ---------- events ----------

app.get(
  "/api/:venueId/events",
  wrap(async (req, res) => {
    const venueId = venueOf(req, res);
    if (!venueId) return;
    const staff = tokenValid((req.header("authorization") ?? "").replace("Bearer ", ""));
    const all = staff && req.query.all === "1";
    const events = await EventDoc.find({ venueId, ...(all ? {} : { published: true }) })
      .sort({ position: 1 })
      .lean();
    res.json(events.map((e) => ({ ...e, id: String(e._id), _id: undefined })));
  })
);

app.post(
  "/api/:venueId/events",
  requireStaff,
  wrap(async (req, res) => {
    const venueId = venueOf(req, res);
    if (!venueId) return;
    const count = await EventDoc.countDocuments({ venueId });
    const e = await EventDoc.create({ ...req.body, venueId, position: count });
    res.status(201).json({ id: String(e._id) });
  })
);

app.patch(
  "/api/events/:id",
  requireStaff,
  wrap(async (req, res) => {
    await EventDoc.findByIdAndUpdate(req.params.id, req.body, { runValidators: true });
    res.json({ ok: true });
  })
);

app.delete(
  "/api/events/:id",
  requireStaff,
  wrap(async (req, res) => {
    await EventDoc.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

// ---------- reservations ----------

/**
 * Public write, with a crude per-IP throttle.
 *
 * A booking form in a browser cannot hold a secret, so this endpoint has to be
 * open. In-memory counters are enough for one instance; put a real limiter or
 * a WAF in front if this ever runs behind more than one process.
 */
const hits = new Map<string, { n: number; until: number }>();
function throttle(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.until) {
    hits.set(ip, { n: 1, until: now + 60_000 });
    return next();
  }
  if (rec.n >= 8) {
    res.status(429).json({ error: "Too many requests — try again shortly" });
    return;
  }
  rec.n++;
  next();
}

app.post(
  "/api/:venueId/reservations",
  throttle,
  wrap(async (req, res) => {
    const venueId = venueOf(req, res);
    if (!venueId) return;
    const { name, email, phone } = req.body ?? {};
    if (!name || (!email && !phone)) {
      res.status(400).json({ error: "A name and either an email or a phone number are required" });
      return;
    }
    const r = await Reservation.create({
      venueId,
      name,
      email: email ?? null,
      phone: phone ?? null,
      partySize: req.body.partySize ?? null,
      wantedFor: req.body.wantedFor ?? null,
      occasion: req.body.occasion ?? null,
      message: req.body.message ?? null,
      source: req.body.source ?? "site",
    });
    res.status(201).json({ id: String(r._id), status: "new" });
  })
);

app.get(
  "/api/reservations",
  requireStaff,
  wrap(async (req, res) => {
    const q: Record<string, unknown> = {};
    if (req.query.venue && req.query.venue !== "all") q.venueId = req.query.venue;
    if (req.query.status && req.query.status !== "all") q.status = req.query.status;
    const list = await Reservation.find(q).sort({ createdAt: -1 }).limit(500).lean();
    res.json(list.map((r) => ({ ...r, id: String(r._id), _id: undefined })));
  })
);

app.patch(
  "/api/reservations/:id",
  requireStaff,
  wrap(async (req, res) => {
    const { status, note } = req.body ?? {};
    if (status && !RESERVATION_STATUSES.includes(status)) {
      res.status(400).json({ error: "Unknown status" });
      return;
    }
    // Status changes are updates, never deletes, so the log stays auditable.
    await Reservation.findByIdAndUpdate(req.params.id, {
      ...(status ? { status } : {}),
      ...(note !== undefined ? { note } : {}),
    });
    res.json({ ok: true });
  })
);

app.get(
  "/api/reservations/summary",
  requireStaff,
  wrap(async (_req, res) => {
    const rows = await Reservation.aggregate([
      { $group: { _id: { venueId: "$venueId", status: "$status" }, n: { $sum: 1 } } },
    ]);
    res.json(rows.map((r) => ({ venueId: r._id.venueId, status: r._id.status, n: r.n })));
  })
);

// ---------- media ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

app.post(
  "/api/upload",
  requireStaff,
  upload.single("file"),
  wrap(async (req, res) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      res.status(500).json({ error: "Cloudinary is not configured" });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const folder = `palacio/${req.body?.venueId ?? "shared"}`;
    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            // Let Cloudinary pick format and quality per requesting browser —
            // that is most of the value of putting media there at all.
            { folder, resource_type: "auto", fetch_format: "auto", quality: "auto" },
            (err, out) =>
              err || !out ? reject(err ?? new Error("Upload failed")) : resolve(out as never)
          )
          .end(file.buffer);
      }
    );
    res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  })
);

app.delete(
  // Query param, not a path segment: Cloudinary public_ids contain slashes
  // (`palacio/noya/abc123`), which a path param would split apart.
  "/api/upload",
  requireStaff,
  wrap(async (req, res) => {
    const publicId = typeof req.query.publicId === "string" ? req.query.publicId : null;
    if (!publicId) {
      res.status(400).json({ error: "publicId is required" });
      return;
    }
    await cloudinary.uploader.destroy(publicId);
    res.json({ ok: true });
  })
);

// ---------- boot ----------

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    mongo: process.env.MONGODB_URI ? "configured" : "missing",
    cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? "configured" : "missing",
    auth: process.env.DASHBOARD_PASSWORD && process.env.DASHBOARD_SECRET ? "configured" : "missing",
  })
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api]", err.message);
  res.status(500).json({ error: "Server error" });
});

connectDb()
  .then(() => {
    app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("[api] could not reach MongoDB:", e.message);
    process.exit(1);
  });
