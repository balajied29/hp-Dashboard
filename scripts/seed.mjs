/**
 * Seeds MongoDB from the content already living in the two sites, so the
 * dashboard opens with the real menus rather than an empty shell.
 *
 * Idempotent: a venue is only seeded if it has no categories yet, so running
 * this twice will not duplicate anything or overwrite later edits.
 *
 *   node scripts/seed.mjs
 */

import "dotenv/config";
import mongoose from "mongoose";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const NOYA = process.env.NOYA_DIR ?? "/Users/balajiedsungoh/Downloads/noya-website";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (copy .env.example to .env)");
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
const db = mongoose.connection.db;

/**
 * Noya's content is a TypeScript module. Rather than compiling it, pull out
 * the two exported array literals and evaluate just those — they contain only
 * plain data, no imports or references, which is what makes this safe.
 */
function readNoyaContent() {
  const file = path.join(NOYA, "content", "noya.ts");
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");

  const grab = (name) => {
    const start = src.indexOf(`export const ${name}`);
    if (start === -1) return null;
    // Seek past the `=` first. Going straight for the next "[" finds the one
    // in the type annotation (`: MenuCategory[] =`), which parses as an empty
    // array and silently seeds nothing.
    const eq = src.indexOf("=", start);
    const open = src.indexOf("[", eq);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]" && --depth === 0) {
        const body = src.slice(open, i + 1).replace(/,(\s*[\]}])/g, "$1");
        return Function(`"use strict"; return (${body});`)();
      }
    }
    return null;
  };

  return { menu: grab("menu"), events: grab("events") };
}

async function seedVenue(venueId, categories, events) {
  const existing = await db.collection("menucategories").countDocuments({ venueId });
  if (existing > 0) {
    console.log(`  ${venueId}: ${existing} categories already present — left alone`);
    return;
  }

  let itemCount = 0;
  for (const [ci, cat] of (categories ?? []).entries()) {
    const { insertedId } = await db.collection("menucategories").insertOne({
      venueId,
      label: cat.label,
      position: ci,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const items = (cat.items ?? []).map((it, ii) => ({
      venueId,
      categoryId: insertedId,
      name: it.name,
      price: typeof it.price === "number" ? it.price : null,
      ingredients: it.ingredients ?? [],
      tags: it.tags ?? null,
      glass: it.glass ?? null,
      garnish: it.garnish ?? null,
      build: it.build ?? undefined,
      taste: it.taste ?? undefined,
      image: it.image ?? null,
      imagePublicId: null,
      available: it.available !== false,
      position: ii,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    if (items.length) {
      await db.collection("menuitems").insertMany(items);
      itemCount += items.length;
    }
  }

  let eventCount = 0;
  if (events?.length) {
    const existingEvents = await db.collection("events").countDocuments({ venueId });
    if (existingEvents === 0) {
      await db.collection("events").insertMany(
        events.map((e, i) => ({
          venueId,
          title: e.title,
          blurb: e.blurb ?? "",
          startsOn: e.date ? new Date(e.date) : null,
          ctaLabel: e.ctaLabel ?? null,
          ctaHref: e.ctaHref ?? null,
          image: null,
          imagePublicId: null,
          published: true,
          position: i,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      eventCount = events.length;
    }
  }

  console.log(
    `  ${venueId}: ${categories?.length ?? 0} categories, ${itemCount} items, ${eventCount} events`
  );
}

console.log("Seeding from site content…");

const noya = readNoyaContent();
if (noya?.menu) {
  await seedVenue("noya", noya.menu, noya.events);
} else {
  console.log("  noya: content/noya.ts not found — skipped");
}

/**
 * Omara's menu is still the invented placeholder set, explicitly labelled as
 * such on its own page. Importing it would dress made-up dishes as real data
 * in a database the kitchen is meant to trust, so only the section headings
 * go in — the real dishes get typed into the dashboard.
 */
const omaraCats = await db.collection("menucategories").countDocuments({ venueId: "omara" });
if (omaraCats === 0) {
  await db.collection("menucategories").insertMany(
    ["To begin", "From the tandoor", "The main table", "Breads & rice", "Sweet endings", "From the bar"].map(
      (label, i) => ({ venueId: "omara", label, position: i, createdAt: new Date(), updatedAt: new Date() })
    )
  );
  console.log("  omara: 6 empty sections created (menu is still placeholder — add real dishes here)");
} else {
  console.log(`  omara: ${omaraCats} categories already present — left alone`);
}

await mongoose.disconnect();
console.log("Done.");
