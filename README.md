# StaySync Availability Manager

## What it does
This mini app implements the core of the PropertyFlow take-home assignment:
- view a month-long calendar of nightly rates and daily status
- update nightly rates for a date range
- block or unblock a date range
- create bookings that reject overlaps
- import a mock channel feed and reconcile it into bookings

## How to run
1. Install dependencies:
   - `npm install`
2. Build the TypeScript project:
   - `npm run build`
3. Start the API server:
   - `npm start`
4. Open `http://localhost:3000`

## API design
- `GET /calendar` returns the current calendar days
- `POST /rate` applies a rate override for a date range
- `POST /block` toggles a range between available and blocked
- `POST /bookings` creates a booking for a range
- `POST /import` imports the mock reservation feed and reconciles it

## Reconciliation decisions
- Duplicate reservations are ignored by tracking the reservation id.
- Cancelled reservations are skipped entirely.
- Conflicting reservations are not imported when they would overlap an existing booking or block.
- Re-running the import does not create duplicates because the import is idempotent.

## What is intentionally left out
- Auth and multi-property support
- Full Angular app structure, because the prompt allowed a self-contained slice and the current UI is a simple single-page interface
- Live deployment and external OTA integrations
