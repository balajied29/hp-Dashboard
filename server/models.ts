import mongoose, { Schema, model, models } from "mongoose";

/**
 * Data model for the Hotel Palacio group.
 *
 * Every document is namespaced by `venueId`, so one dashboard and one database
 * serve both Omara and Noya without the two ever bleeding into each other.
 * Queries must always filter on it.
 */

export const VENUE_IDS = ["omara", "noya"] as const;
export type VenueId = (typeof VENUE_IDS)[number];

const venueField = {
  type: String,
  enum: VENUE_IDS,
  required: true,
  index: true,
};

// ---------- menu ----------

const MenuCategorySchema = new Schema(
  {
    venueId: venueField,
    label: { type: String, required: true, trim: true },
    position: { type: Number, default: 0 },
  },
  { timestamps: true }
);
MenuCategorySchema.index({ venueId: 1, position: 1 });

const MenuItemSchema = new Schema(
  {
    venueId: venueField,
    categoryId: { type: Schema.Types.ObjectId, ref: "MenuCategory", required: true, index: true },
    name: { type: String, required: true, trim: true },
    /** Whole rupees. Null means market price / unpriced — not zero. */
    price: { type: Number, default: null, min: 0 },
    ingredients: { type: [String], default: [] },
    tags: { type: String, default: null },
    glass: { type: String, default: null },
    garnish: { type: String, default: null },
    build: {
      type: [{ _id: false, measure: String, what: String }],
      default: undefined,
    },
    taste: {
      type: {
        _id: false,
        sweet: { type: Number, min: 0, max: 5 },
        sour: { type: Number, min: 0, max: 5 },
        bitter: { type: Number, min: 0, max: 5 },
        strength: { type: Number, min: 0, max: 5 },
      },
      default: undefined,
    },
    /** Cloudinary secure_url, plus the public_id so it can be replaced/destroyed. */
    image: { type: String, default: null },
    imagePublicId: { type: String, default: null },
    /** The "86 it" toggle — false hides it from the sites immediately. */
    available: { type: Boolean, default: true },
    position: { type: Number, default: 0 },
  },
  { timestamps: true }
);
MenuItemSchema.index({ venueId: 1, categoryId: 1, position: 1 });

// ---------- events ----------

const EventSchema = new Schema(
  {
    venueId: venueField,
    title: { type: String, required: true, trim: true },
    blurb: { type: String, default: "" },
    /** Null means an evergreen offering rather than a dated event. */
    startsOn: { type: Date, default: null },
    ctaLabel: { type: String, default: null },
    ctaHref: { type: String, default: null },
    image: { type: String, default: null },
    imagePublicId: { type: String, default: null },
    published: { type: Boolean, default: true },
    position: { type: Number, default: 0 },
  },
  { timestamps: true }
);
EventSchema.index({ venueId: 1, position: 1 });

// ---------- reservations ----------

export const RESERVATION_STATUSES = ["new", "confirmed", "declined"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

const ReservationSchema = new Schema(
  {
    venueId: venueField,
    name: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    partySize: { type: Number, default: null, min: 1, max: 200 },
    /** When the guest asked for, not when they submitted. */
    wantedFor: { type: Date, default: null },
    occasion: { type: String, default: null },
    message: { type: String, default: null },
    status: { type: String, enum: RESERVATION_STATUSES, default: "new", index: true },
    /** Staff note — never shown to the guest. */
    note: { type: String, default: null },
    source: { type: String, default: "site" },
  },
  { timestamps: true }
);
// The dashboard's default view: newest first, per venue, filtered by status.
ReservationSchema.index({ venueId: 1, status: 1, createdAt: -1 });

// `models.X ??` guards against redefinition when the dev server hot-reloads.
export const MenuCategory =
  models.MenuCategory ?? model("MenuCategory", MenuCategorySchema);
export const MenuItem = models.MenuItem ?? model("MenuItem", MenuItemSchema);
export const EventDoc = models.Event ?? model("Event", EventSchema);
export const Reservation = models.Reservation ?? model("Reservation", ReservationSchema);

/**
 * Connection cache.
 *
 * Held on globalThis, not in a module variable, because on serverless the
 * module can be re-evaluated between invocations while the process survives.
 * Without this, every request opens a new connection and the Atlas pool is
 * exhausted within minutes.
 */
const cache = globalThis as typeof globalThis & {
  __palacioMongoose?: Promise<typeof mongoose> | null;
};

export async function connectDb(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!cache.__palacioMongoose) {
    cache.__palacioMongoose = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 8000,
        // One connection per warm instance is plenty and keeps well inside
        // Atlas's free-tier cap when several instances are warm at once.
        maxPoolSize: 5,
      })
      .catch((err) => {
        // Don't cache a failed attempt, or every later request inherits it.
        cache.__palacioMongoose = null;
        throw err;
      });
  }
  return cache.__palacioMongoose;
}
