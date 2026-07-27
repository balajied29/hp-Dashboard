/**
 * Seeds Omara's real menu, transcribed from the venue's own menu PDF and
 * verified page-by-page against the rendered images.
 *
 * Replaces whatever is in Omara's menu — the previous contents were the
 * invented placeholder set, which had to go.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";

const SRC = process.env.MENU_JSON;
const uri = process.env.MONGODB_URI;
if (!uri || !SRC) { console.error("MONGODB_URI and MENU_JSON are required"); process.exit(1); }

const data = JSON.parse(readFileSync(SRC, "utf8"));

// Pages that continue a list carry no heading of their own; the transcription
// flagged them rather than guessing. Fold them back into the section above.
const CONT = /no section heading|continuation|continues from/i;
const sections = [];
for (const s of data.sections) {
  if (CONT.test(s.label) && sections.length) sections[sections.length - 1].items.push(...s.items);
  else sections.push({ label: s.label.trim(), items: [...s.items] });
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection.db;

const oldCats = await db.collection("menucategories").find({ venueId: "omara" }).toArray();
const oldIds = oldCats.map((c) => c._id);
const removedItems = oldIds.length
  ? (await db.collection("menuitems").deleteMany({ categoryId: { $in: oldIds } })).deletedCount
  : 0;
await db.collection("menucategories").deleteMany({ venueId: "omara" });
console.log(`  cleared placeholder: ${oldCats.length} sections, ${removedItems} items`);

let n = 0;
for (const [ci, sec] of sections.entries()) {
  const { insertedId } = await db.collection("menucategories").insertOne({
    venueId: "omara", label: sec.label, position: ci,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const items = sec.items.map((it, ii) => ({
    venueId: "omara",
    categoryId: insertedId,
    name: it.name.replace(/&amp;/g, "&").trim(),
    // null is preserved deliberately: these are multi-variant dishes with no
    // single printed price. Inventing one would be worse than showing none.
    price: Number.isInteger(it.price) ? it.price : null,
    ingredients: [],
    tags: [it.veg === true ? "veg" : it.veg === false ? "non-veg" : null, it.spice]
      .filter(Boolean).join(" / ") || null,
    glass: null, garnish: null, image: null, imagePublicId: null,
    available: true,
    position: ii,
    description: (it.description ?? "").replace(/&amp;/g, "&").trim() || null,
    sourcePage: it.page ?? null,
    createdAt: new Date(), updatedAt: new Date(),
  }));
  if (items.length) { await db.collection("menuitems").insertMany(items); n += items.length; }
}

console.log(`  seeded: ${sections.length} sections, ${n} dishes`);
const priced = await db.collection("menuitems").countDocuments({ venueId: "omara", price: { $ne: null } });
console.log(`  with a price: ${priced} / ${n}`);
await mongoose.disconnect();
