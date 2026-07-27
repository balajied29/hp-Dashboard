# Hotel Palacio — staff dashboard

One dashboard behind both venues. Reservations, menus and events for **Omara**
and **Noya by NYX**, sharing one database.

## Stack

- **MongoDB** + Mongoose — every document namespaced by `venueId`
- **Express** (Node) — the API both sites and the dashboard talk to
- **Cloudinary** — image uploads, transformed per requesting browser
- **Next.js** — the dashboard UI

## Running it

```bash
cp .env.example .env      # then fill it in — see below
npm install
npm run seed              # imports the menus already in the sites
npm run dev:all           # API on :4000, dashboard on :3200
```

`npm run api` and `npm run dev` run the two halves separately.

### Environment

| Variable | Why |
|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/palacio` locally, or an Atlas SRV string |
| `DASHBOARD_PASSWORD` | the passphrase staff type |
| `DASHBOARD_SECRET` | signs the session token — long and random |
| `CLOUDINARY_*` | cloud name, API key, API secret |
| `ALLOWED_ORIGINS` | which origins may call the API from a browser |

**The API refuses every login if `DASHBOARD_PASSWORD` or `DASHBOARD_SECRET` is
missing.** That is deliberate: a missing password must never mean an open door.

## How access works

Two audiences, two levels of trust.

**The sites** read published content and post reservations. Reading is open.
Posting a reservation is rate-limited but unauthenticated, because a booking
form in a browser cannot hold a secret.

**The dashboard** reads everything — including 86'd items and unpublished
events — and writes. That needs the staff token: the passphrase is exchanged
for an HMAC-signed, 12-hour token, compared in constant time. The passphrase
itself is never stored anywhere.

## The API

Public:

```
GET  /api/:venue/menu             published, available items
GET  /api/:venue/events           published events
POST /api/:venue/reservations     a booking request
```

Staff (`Authorization: Bearer <token>`):

```
POST   /api/auth/login
GET    /api/reservations?venue=&status=
PATCH  /api/reservations/:id            { status, note }
GET    /api/:venue/menu?all=1           includes 86'd items
POST   /api/:venue/menu/categories
POST   /api/:venue/menu/items
PATCH  /api/menu/items/:id
DELETE /api/menu/items/:id
POST   /api/upload                      multipart to Cloudinary
```

## Connecting the sites

Both sites already read content through one accessor module, so pointing them
here means changing one function body — no page or component changes:

```ts
// noya-website/content/index.ts
async getMenu(id) {
  const res = await fetch(`${process.env.API_URL}/api/${id}/menu`, {
    next: { revalidate: 60 },
  });
  return res.json();
}
```

Omara's content is still inline in its pages and needs that accessor layer
added first.

## Decisions worth knowing

**Reservations are never deleted.** Confirming or declining updates a status,
so the log stays auditable — you can always see what was asked for and what
was decided.

**Price `null` is not price `0`.** An empty price field means market price or
unpriced; zero would mean free.

**Availability is the urgent path.** The 86 toggle hides an item from the
public menu immediately, because running out mid-service is the thing this
screen most needs to do fast. Verified: toggling an item off removes it from
`GET /api/:venue/menu` on the next read.

**Omara's menu was not imported.** Its dishes are still the invented
placeholder set, explicitly labelled as such on its own menu page. Seeding
them would dress made-up dishes as real data in a database the kitchen is
meant to trust, so the seed creates Omara's six section headings and leaves
the dishes to be typed in.

## Still to do

- Point both sites at this API (Noya is one function; Omara needs its
  accessor layer first)
- Add reservation forms to the sites that POST here — the Omara enquiry form
  currently composes an email to a placeholder address and reaches nobody
- Fill in Cloudinary credentials; uploads return a clear error until then
- Per-user logins, if you ever want an audit trail of *who* confirmed what
