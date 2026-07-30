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
| `GET /property` | — | Property name, base rate, and the active pricing rules (`pricing.weekendMultiplier`, `pricing.minStayNights`) |
| `GET /calendar?start=&end=` | — | Inclusive range of `{date, rate, status, bookingGuest?}` — `rate` already has the weekend surcharge/override applied |
| `POST /rate` | `{start, end, rate}` | Overrides rate for each day in the **inclusive** range |
| `POST /block` | `{start, end, blocked}` | Blocks/unblocks each day in the **inclusive** range; rejects blocking a day that's already booked (409) |
| `POST /bookings` | `{checkIn, checkOut, guest}` | Creates a booking; **checkOut is exclusive** (nights = checkIn..checkOut-1); rejects a stay shorter than the minimum (400) or one that overlaps an existing booking/block (409) |
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

## Stretch goal: dynamic pricing rules

Two rules, applied on top of the base rate:

1. **Weekend surcharge** — Friday and Saturday nights are priced at
   `baseRate × 1.25` (rounded), everything else at `baseRate`. This is
   resolved at *read time* in `effectiveRate()` (`backend/src/availability.ts`),
   not persisted — a day only gets a row in `day_overrides` when something
   actually happened to it (a manual rate override, a block, a booking).
2. **Minimum-stay rule, weekends only** — a booking created via
   `POST /bookings` must be at least `MIN_STAY_NIGHTS` (2) nights **if any of
   its nights fall on a Friday or Saturday**; a pure weeknight stay (e.g. a
   single Tuesday night) has no minimum. A shorter weekend-including request
   is rejected with `400` and `reason: "min-stay"` before availability is
   even checked.

Key decisions:

- **An explicit rate override always wins over the weekend rule.** If the
  owner has set a specific rate for a Saturday via `POST /rate`, that's what
  shows and what's charged — the dynamic rule only fills in days nobody has
  touched. This is why `DayRecord.rate` is `number | null`: `null` means
  "no override, apply the rules"; a real number means "this exact figure,
  full stop." Precedence logic lives entirely in `effectiveRate()`.
- **The minimum-stay rule only applies when the stay touches a weekend
  night, and only gates new direct bookings, not the channel feed.** Real
  minimum-stay policies are almost always a weekend/peak-night thing (protect
  the Friday/Saturday from a single low-value night), not a blanket rule —
  a lone Tuesday booking shouldn't be rejected. And a reservation arriving
  from Channex/an OTA is already a confirmed external booking — rejecting a
  1-night OTA reservation for violating a policy the OTA guest never saw
  would be wrong; `reconcileReservations` deliberately doesn't check it.
- **The displayed rate for an already-booked night is recomputed on every
  read**, not frozen at the moment of booking. There's no invoicing/pricing-
  history concept in this app — only calendar management — so "what would
  this night cost today" is what's shown, consistent with how the original
  (pre-pricing-rules) version already behaved for booked days.
- `GET /property` exposes both constants (`pricing.weekendMultiplier`,
  `pricing.minStayNights`) so the frontend can display them instead of
  hardcoding a second copy of the business rule.

## UX notes

- The calendar is a real month grid (correct weekday alignment, not just a
  flat list of days) with month navigation.
- Rate/block actions use click-to-select on the grid: click a day to start a
  range, click another (or the same day again) to complete it.
- A failed booking (date clash) surfaces as an inline dismissible banner
  driven by the API's 409 response — not a browser `alert()` and not an
  unhandled error.
- Colour-coded day cells: green = available, red = booked (with guest name),
  amber = blocked, with a rate pill per day and a legend explaining the
  weekend surcharge.
- The minimum-stay rule surfaces the same way a booking conflict does — an
  inline banner ("Minimum stay is 2 nights for stays that include a Fri/Sat
  night (requested 1).") rather than a raw validation error, and the "New
  booking" card states the weekend-only minimum up front so it's not a
  surprise on submit.

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
- The other stretch-goal options (mobile, deploy, a dedicated test-focused
  pass, auth) — the brief asks for one at most; dynamic pricing was chosen
  because it exercises the same "rules on top of base data" thinking as the
  reconciliation logic, and stacks cleanly on the existing rate/override model.
- Deployment: runs locally only.
- A seasonal multiplier (the brief's other pricing example) — weekend +
  minimum-stay already demonstrate the pattern; a third overlapping rule
  would mostly add "which rule wins when both apply" complexity without
  showing a new capability.

## What I'd do next with more time

- Move the sparse-override scan to an indexed range query once it'd matter.
- A booking-cancellation endpoint (`DELETE /bookings/:id`), since a PMS
  without a way to undo a booking is only half the story.
- Tests around the Express routes themselves (currently the route layer is
  thin and the logic underneath — `backend/src/availability.ts` — is what's
  tested; I'd add a supertest-based suite for status codes and validation).
- A seasonal multiplier and a small rules-precedence table, if pricing grew
  a third rule — right now "override beats weekend rule" is the only
  precedence decision and it's simple enough to live as a comment.
