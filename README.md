# StaySync — availability & pricing manager

Live: **https://stay-sync-eta.vercel.app**

A booking calendar for a single holiday rental (Seaside Cottage,
£120/night base rate). View rates & availability, override rates,
block/unblock dates, create/cancel bookings, and reconcile a mock channel
feed — all without double-booking.

- `backend/` — Node.js + TypeScript + Express, SQLite (`better-sqlite3`)
- `frontend/` — Angular (standalone components + signals)

Two independent projects (separate `package.json`/`node_modules`),
talking only over HTTP.

## Run locally

```
cd backend && npm install && npm run build && npm start   # http://127.0.0.1:3100/api
```
```
cd frontend && npm install && npm start                   # http://localhost:4200
```

Data persists to `backend/data/staysync.db` (override with `DB_PATH`).

**Tests**
```
cd backend && npm test    # booking/pricing/import logic
cd frontend && npm test
```

## API

All dates `YYYY-MM-DD`. Every route is under `/api`.

| Endpoint | Body | Notes |
|---|---|---|
| `GET /api/property` | — | base rate + pricing rules |
| `GET /api/calendar?start=&end=` | — | inclusive range |
| `POST /api/rate` | `{start, end, rate}` | inclusive range |
| `POST /api/block` | `{start, end, blocked}` | inclusive; 409 if already booked |
| `POST /api/bookings` | `{checkIn, checkOut, guest}` | checkOut exclusive; 400 min-stay, 409 overlap |
| `DELETE /api/bookings/:id` | — | frees nights; 404 if unknown |
| `POST /api/import` | reservation[] | checkOut exclusive |

`rate`/`block` are inclusive (they set specific calendar cells).
`bookings`/`import` use exclusive checkout, matching hotel convention
(check-out day isn't a booked night) — same rule for manual and
imported bookings.

## Key features

- **Weekend surcharge**: Fri/Sat nights +25%, unless a manual rate
  override is set (override always wins).
- **Minimum 2-night stay** for direct bookings that include a Fri/Sat
  night — a pure weeknight stay has no minimum. Doesn't apply to the
  imported feed (an OTA booking is already confirmed under its own rules).
- **Channel-feed import** is idempotent: duplicates within a feed,
  cancelled entries, already-imported ids, and real conflicts (checked
  against the calendar *and* the rest of the batch) are each handled and
  reported separately.
- **Cold-start notice**: a banner appears if the Render backend is slow
  to wake from idle, and clears itself once data loads.

## Deployment

Frontend on Vercel, backend on Render — not one platform, because
Vercel's combined frontend+backend "services" beta has a real bug for
this repo's layout (subdirectory root + compiled `dist/` output): it
splits a service's code and its own `node_modules` into directories that
aren't ancestors of each other, so the deployed function can never find
its dependencies. Confirmed by deploying and reading the file mapping it
produced. `vercel.json` proxies `/api/*` to the Render service instead.

SQLite on Render's free tier has no persistent disk — data can be wiped
on redeploy or after an idle spin-down. Fine for a demo; production would
want a hosted database.

## Left out / next steps

Left out: auth, multi-property support, editing a booking in place
(cancel + rebook instead), the iCal feed format.

Next: a real hosted database instead of local SQLite, an indexed
calendar-range query, and HTTP-route-level tests on top of the existing
business-logic tests.
