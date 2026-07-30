# StaySync — availability & pricing manager

This app manages the booking calendar for one holiday rental (Seaside
Cottage, £120/night base rate). You can look at rates and availability,
change rates, block or unblock dates, take bookings, cancel bookings, and
import a mock "channel feed" of reservations (like you'd get from Airbnb or
Booking.com) — all without ever double-booking a night.

- **`backend/`**: the API. Node.js + TypeScript + Express, with data saved
  in a SQLite file (via `better-sqlite3`).
- **`frontend/`**: the web page. Angular (standalone components + signals).

Backend and frontend are two separate projects — each has its own
`package.json` and `node_modules`, and each runs as its own process. They
only talk to each other over plain HTTP.

## How to run it

You need two terminals: one for the API, one for the web page.

**1. Backend** (`backend/`)
```
cd backend
npm install
npm run build
npm start
```
This starts the API at `http://127.0.0.1:3100`, with every route under
`/api` (e.g. `http://127.0.0.1:3100/api/property`). It saves data to
`backend/data/staysync.db`, which is created automatically the first time
(you can point it somewhere else with the `DB_PATH` environment variable).

**2. Frontend** (`frontend/`)
```
cd frontend
npm install
npm start
```
This opens the app at `http://localhost:4200`. It talks straight to
`http://127.0.0.1:3100/api` — no proxy setup needed, since the API allows
cross-origin requests (CORS) from the browser.

**Running the tests**
```
cd backend && npm test   # tests the booking/pricing/import logic
cd frontend && npm test  # a basic test that the app component renders
```

## The API

There's only one property, so URLs don't need a property id. Every date is
written as `YYYY-MM-DD`. Every route below lives under `/api` (e.g.
`GET /api/property`) — this keeps local dev and the deployed site (see
"Deploying to Vercel" below) working the exact same way.

| Endpoint | What you send | What it does |
|---|---|---|
| `GET /api/property` | — | Returns the property name, base rate, and the current pricing rules (weekend surcharge %, minimum-stay nights) |
| `GET /api/calendar?start=&end=` | — | Returns every day in that range (inclusive) with its rate, status, and guest name if booked. The rate already includes any weekend surcharge or manual override. |
| `POST /api/rate` | `{start, end, rate}` | Sets a specific rate for every day in that range (inclusive) |
| `POST /api/block` | `{start, end, blocked}` | Blocks or unblocks every day in that range (inclusive). Refuses to block a day that's already booked (returns 409). |
| `POST /api/bookings` | `{checkIn, checkOut, guest}` | Creates a booking. `checkOut` is exclusive (see below). Rejects a stay that's too short (400) or clashes with an existing booking/block (409). |
| `DELETE /api/bookings/:bookingId` | — | Cancels a booking and frees its nights back to available. Returns 404 if that booking id doesn't exist. |
| `POST /api/import` | a list of reservations | Reconciles a channel feed into the calendar (explained below). `checkOut` is exclusive here too. |

**Why "inclusive" for some endpoints and "exclusive" for others?** `rate`
and `block` work on specific calendar cells — "set these exact days" — so
the range includes both the start and end day. Bookings work differently:
they follow the normal hotel rule where `checkOut` is the day you leave, not
a night you pay for. So a stay from the 10th to the 12th only books the
nights of the 10th and 11th — you could have a new guest check in on the
12th, same day. This matches how a real booking site works, and it's the
same rule for both a manual booking and an imported one.

### How data is stored

Most days have nothing special about them, so we don't store a row for
every single day. There's one table, `day_overrides`, that only has a row
for a day once something happens to it — a rate change, a block, or a
booking. Any day with no row is just "available, at the normal base rate."

A second table, `imported_reservations`, keeps a list of every channel-feed
reservation id we've already processed. That way, if you run the same
import twice, the second run does nothing new — it recognizes the ids it's
already seen.

## How the channel-feed import works

When you import a list of reservations, each one is handled in this order:

1. **Cancelled** reservations are skipped straight away — never booked.
2. **Duplicates**: if the same reservation id shows up twice in the same
   feed, only the first one counts. The rest are reported separately.
3. **Already imported**: if we've already processed this id in an earlier
   import, we skip it again and report it as "already imported" — not as a
   conflict. This is what makes re-running an import safe.
4. **Conflicts**: everything left over is checked against the existing
   calendar *and* against reservations already accepted earlier in the same
   batch. Whoever claims a night first, in feed order, gets it — anyone
   trying to claim an already-taken night is rejected and listed as a
   conflict, with a reason.

The sample file `reservations.json` shows all four cases at once: one
reservation id appears twice (a duplicate), one is marked cancelled, and two
different bookings genuinely overlap on the same night — a real conflict,
not a made-up one, so the test suite actually exercises it.

## Bonus feature: dynamic pricing

Two extra pricing rules sit on top of the base rate:

1. **Weekend surcharge** — Friday and Saturday nights cost 25% more than
   the base rate (rounded to a whole number). This isn't stored anywhere;
   it's calculated fresh every time you read the calendar, in a function
   called `effectiveRate()`. A day only gets a database row when something
   is actually done to it.
2. **Minimum 2-night stay, but only for weekends** — a booking that
   includes a Friday or Saturday night must be at least 2 nights. A booking
   for a single weeknight (say, just a Tuesday) has no minimum at all.

A few choices worth explaining:

- **A manual rate override always beats the weekend surcharge.** If you've
  set a specific price for a Saturday, that's the price shown and charged —
  the weekend rule only fills in days nobody has touched.
- **The minimum-stay rule only applies to bookings made directly in this
  app, not to imported reservations.** A reservation coming from an OTA
  (like Airbnb) is already a confirmed booking made under that OTA's own
  rules — it wouldn't be fair to reject it here for breaking a policy the
  guest never even saw.
- **The price shown for an already-booked night updates over time**, rather
  than being frozen at the moment it was booked. This app only manages the
  calendar, not invoices, so it always shows "what this night would cost
  today."
- `GET /property` returns both pricing numbers (the surcharge percentage
  and the minimum nights) so the app can display them instead of having the
  same numbers hardcoded in two places.

## Notes on the interface

- The calendar looks like a real month (correct weekday columns), with
  buttons to move to the previous/next month.
- To set a rate or block dates, click a day to start a range, then click
  another day to finish it.
- If a booking fails (say, the dates clash), you see a friendly message on
  the page — never a raw browser pop-up or a crash.
- Day colours: green = available, red = booked (shows the guest's name),
  amber = blocked. Each day also shows its price, and there's a legend
  explaining the weekend surcharge.
- The minimum-stay rule shows the same kind of friendly message as a
  booking clash, and the "New booking" form explains the rule up front so
  it's not a surprise.
- Every booking in the current month is also listed below the calendar
  (guest, dates, number of nights), with a **Cancel** button per booking
  (asks for confirmation first) so you don't have to hunt through the grid
  to find and undo one.

## Deploying to Vercel

`vercel.json` at the repo root deploys this as two services from one
project: `frontend` (built with the Angular framework preset) and `backend`
(run as a plain Node service). A rewrite sends anything under `/api/*` to
the backend and everything else to the frontend, so both are served from
the same domain — which is also why the frontend calls a relative `/api`
path in production instead of a hardcoded address (see
`frontend/src/environments/`).

One real limitation: the backend's SQLite file lives at `/tmp` in that
environment, which is writable but **not persistent** — data can be wiped
on a redeploy or when the service restarts after being idle. That's fine
for demoing the app, but a production deployment would need a real hosted
database (e.g. Postgres, Turso) instead of a local SQLite file.

## Key decisions and trade-offs

- **SQLite instead of Postgres/Mongo**: nothing to install or configure —
  it's just a file, so anyone can run this project immediately. The
  trade-off shows up in the Vercel deployment above.
- **Only storing days that changed, not every day**: keeps the database
  small and avoids pre-filling years of rows. The trade-off is that reading
  a calendar range has to scan the whole overrides table rather than using
  an index — perfectly fine at this size (one property, a few years of
  days at most), but would need a different approach for many properties.
- **No login system, one property only**: this was out of scope for the
  task. The database is still shaped so adding more properties later would
  just mean adding a `property_id` column, not rebuilding everything.
- **The frontend calls the API by its full address, not through a build
  proxy** — this keeps setup simple when running both `npm start` commands
  side by side.

## What I deliberately left out

- User accounts/login, and managing more than one property.
- Editing an existing booking's dates (you can cancel and rebook, but not
  change a booking in place).
- The calendar-file (`.ics`) version of the channel feed — only the JSON
  version is supported.
- The other bonus-feature options (mobile support, deploying it online, a
  bigger test suite, login system) — the task only asked for one bonus
  feature. I picked dynamic pricing because it uses the same kind of
  thinking as the import logic (rules layered on top of plain data).
- A seasonal price multiplier (a second pricing idea from the brief) — the
  weekend surcharge and minimum-stay rule already show the same pattern,
  and a third rule would mostly add complexity about which rule wins,
  without demonstrating anything new.

## What I'd do with more time

- Swap SQLite-on-`/tmp` for a real hosted database, so data survives a
  redeploy on Vercel instead of living in ephemeral storage.
- Make the calendar-range lookup faster (an indexed query) once the
  overrides table got large enough for it to matter.
- Add tests that go through the actual HTTP routes, not just the logic
  underneath — right now the routes are thin and the logic in
  `backend/src/availability.ts` is what's tested directly. A route-level
  test suite would also check status codes and input validation.
- A seasonal multiplier and a small table explaining which pricing rule
  wins when more than one applies, if a third rule got added — right now
  "manual override beats the weekend rule" is the only such decision, and
  it's simple enough to explain in a code comment.
