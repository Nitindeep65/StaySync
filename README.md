# StaySync — availability & pricing manager

A single-property (Seaside Cottage, £120/night base rate) availability
calendar: view rates/status, override rates, block/unblock dates, take
bookings, and reconcile a mock channel feed — without double-booking.

- **`backend/`**: Node.js / TypeScript / Express, persisted to SQLite (`better-sqlite3`).
- **`frontend/`**: Angular (standalone components, signals).

The two are fully independent projects — separate `package.json`, separate
`node_modules`, separate dev servers — talking to each other only over HTTP.

## How to run from a clean clone

Two processes: the API and the Angular dev server. Run each in its own terminal.

**1. Backend** (`backend/`)
```
cd backend
npm install
npm run build
npm start
```
Listens on `http://127.0.0.1:3100`. Data persists to `backend/data/staysync.db`
(created automatically; override with `DB_PATH`).

**2. Frontend** (`frontend/`)
```
cd frontend
npm install
npm start
```
Opens on `http://localhost:4200` and talks directly to `http://127.0.0.1:3100`
(CORS is enabled on the API for this). No proxy config needed.

**Tests**
```
cd backend && npm test   # availability/reconciliation logic (node:test)
cd frontend && npm test  # component smoke test (vitest via Angular CLI)
```

## API design

One property, so no property id in the URL. All dates are `YYYY-MM-DD`.

| Endpoint | Body / Query | Behaviour |
|---|---|---|
| `GET /property` | — | Property name + base rate |
| `GET /calendar?start=&end=` | — | Inclusive range of `{date, rate, status, bookingGuest?}` |
| `POST /rate` | `{start, end, rate}` | Overrides rate for each day in the **inclusive** range |
| `POST /block` | `{start, end, blocked}` | Blocks/unblocks each day in the **inclusive** range; rejects blocking a day that's already booked (409) |
| `POST /bookings` | `{checkIn, checkOut, guest}` | Creates a booking; **checkOut is exclusive** (nights = checkIn..checkOut-1); rejects on any overlap with an existing booking or block (409) |
| `POST /import` | `ImportReservation[]` | Reconciles a channel feed into bookings (see below); **checkOut is exclusive** here too |

`rate` and `block` use an **inclusive** range because they operate on calendar
cells directly ("set these specific days"). `bookings` and the channel-feed
`import` use **exclusive checkout**, matching the hospitality convention
(the guest leaves that morning, so the checkout day itself isn't a booked
night) and matching each other, so the same date pair means the same thing
whether it comes from a human or from a channel.

### Storage shape

Calendar state is sparse: a `day_overrides` table only stores rows for days
that have been touched (rate override, block, or booking); everything else
implicitly falls back to the property's base rate and `available` status.
A separate `imported_reservations` table records which channel-feed
reservation ids have already been committed, so re-running an import is a
true no-op rather than relying on incidental side effects.

## Reconciliation decisions (the interesting bit)

Given a feed of reservations, in order:

1. **Cancelled** (`status: "cancelled"`) reservations are skipped outright —
   never booked, never counted as a conflict.
2. **Duplicates** are deduped by `id`: first occurrence in the feed wins,
   later ones with the same id are dropped and reported separately
   (`duplicatesInFeed`).
3. **Already-imported** reservations (an id committed by an earlier call to
   `/import`) are skipped and reported as `alreadyImported`, not
   re-processed and not reported as a conflict. This is what makes
   re-running the import idempotent — it's an explicit id ledger, not a
   side effect of the calendar already showing those nights as booked.
4. **Conflicts**: remaining reservations are checked, in feed order, against
   the full persisted calendar *and* against reservations already accepted
   earlier in the same batch. The first reservation to claim a night wins;
   anyone claiming an already-claimed night is rejected and reported in
   `conflicts` with a reason. This is a first-come-first-served rule within
   a batch, which is the simplest defensible behaviour without a "priority"
   concept the brief doesn't define.

The bundled `reservations.json` demonstrates all four cases: id `1001`
appears twice (duplicate), `0999` is cancelled, and `1003` (Sam P., Aug 13–16)
genuinely overlaps `1002` (Maria S., Aug 15–18) on the night of Aug 15 — a
real conflict, not a synthetic one, so the conflict path is actually
exercised by the test suite.

## UX notes

- The calendar is a real month grid (correct weekday alignment, not just a
  flat list of days) with month navigation.
- Rate/block actions use click-to-select on the grid: click a day to start a
  range, click another (or the same day again) to complete it.
- A failed booking (date clash) surfaces as an inline dismissible banner
  driven by the API's 409 response — not a browser `alert()` and not an
  unhandled error.
- Colour-coded day cells: grey = available, red = booked (with guest name),
  yellow = blocked.

## Key decisions & trade-offs

- **SQLite over Postgres/Mongo**: zero setup for a reviewer running this
  locally; a single file, no external service.
- **Sparse override table instead of a dense per-day table**: avoids seeding
  years of rows up front; a day with no row is just "available at base
  rate." Trade-off: computing a calendar range means a full table scan of
  overrides rather than an indexed range query — fine at this scale (one
  property, a few thousand days at most), would need revisiting for many
  properties/years of history.
- **No auth, single property**: out of scope per the brief; the schema
  (`property` table with `id=1`) is deliberately shaped so multi-property
  would mean adding a `property_id` column, not a rewrite.
- **Booking cancellation isn't implemented**: the brief asks for create +
  reject-overlap, not cancel; didn't want to invent an unrequested endpoint.
- **Angular talks to the API by absolute URL + CORS**, not a build-time
  proxy — simpler for a reviewer running two `npm start`s side by side.

## What I deliberately left out

- Authentication and multi-property support.
- Editing/cancelling an existing booking.
- The iCal (`.ics`) variant of the feed — only the JSON form is implemented.
- Any stretch goal (dynamic pricing, mobile, deploy, more tests) — the brief
  asks for one at most, and I judged the core (persistence + correct
  checkout/conflict/idempotency semantics + a real Angular UI) as more
  valuable to get right than adding a fifth feature on top.
- Deployment: runs locally only.

## What I'd do next with more time

- Move the sparse-override scan to an indexed range query once it'd matter.
- A booking-cancellation endpoint (`DELETE /bookings/:id`), since a PMS
  without a way to undo a booking is only half the story.
- Tests around the Express routes themselves (currently the route layer is
  thin and the logic underneath — `backend/src/availability.ts` — is what's
  tested; I'd add a supertest-based suite for status codes and validation).
- A minimum-stay / dynamic-pricing rule as the stretch goal, since pricing
  logic is the area most likely to grow in complexity.
