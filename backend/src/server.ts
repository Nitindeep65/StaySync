import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applyBlockStatus,
  applyRateOverride,
  buildCalendarRange,
  cancelBooking,
  createBooking,
  reconcileReservations,
  MIN_STAY_NIGHTS,
  WEEKEND_RATE_MULTIPLIER,
  type ImportReservation
} from './availability';
import { CalendarStore } from './store';

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Deployed bundles (e.g. on Vercel) ship a read-only filesystem outside
 * /tmp — falling back to __dirname there would crash on the mkdirSync
 * below. /tmp is writable but ephemeral: fine for a demo, not a substitute
 * for a real hosted database if this needs to persist across deploys.
 */
const defaultDataDir = process.env.VERCEL ? '/tmp/staysync-data' : path.join(__dirname, '..', '..', 'data');
const dbPath = process.env.DB_PATH || path.join(defaultDataDir, 'staysync.db');
const store = new CalendarStore(dbPath);

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Mounted at /api below so the path a browser calls matches the
// /api(/.*)? rewrite in vercel.json, in both local dev and production.
const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

api.get('/property', (_req, res) => {
  res.json({
    ...store.getProperty(),
    pricing: {
      weekendMultiplier: WEEKEND_RATE_MULTIPLIER,
      minStayNights: MIN_STAY_NIGHTS
    }
  });
});

api.get('/calendar', (req, res) => {
  const { start, end } = req.query as { start?: string; end?: string };
  if (!isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ error: 'start and end query params are required as YYYY-MM-DD.' });
  }
  if (start > end) {
    return res.status(400).json({ error: 'start must not be after end.' });
  }
  const { baseRate } = store.getProperty();
  const overrides = store.getAllOverrides();
  return res.json(buildCalendarRange(overrides, baseRate, start, end));
});

api.post('/rate', (req, res) => {
  const { start, end, rate } = req.body as { start: string; end: string; rate: number };
  if (!isValidDate(start) || !isValidDate(end) || typeof rate !== 'number' || rate <= 0) {
    return res.status(400).json({ error: 'start, end (YYYY-MM-DD) and a positive rate are required.' });
  }
  const { baseRate } = store.getProperty();
  const overrides = store.getAllOverrides();
  const updates = applyRateOverride(overrides, baseRate, start, end, rate);
  store.saveOverrides(updates);
  return res.json(buildCalendarRange(store.getAllOverrides(), baseRate, start, end));
});

api.post('/block', (req, res) => {
  const { start, end, blocked } = req.body as { start: string; end: string; blocked: boolean };
  if (!isValidDate(start) || !isValidDate(end) || typeof blocked !== 'boolean') {
    return res.status(400).json({ error: 'start, end (YYYY-MM-DD) and a boolean blocked are required.' });
  }
  const { baseRate } = store.getProperty();
  const overrides = store.getAllOverrides();
  const result = applyBlockStatus(overrides, baseRate, start, end, blocked);
  if (!result.ok) {
    return res.status(409).json({ error: result.error });
  }
  store.saveOverrides(result.updates ?? []);
  return res.json(buildCalendarRange(store.getAllOverrides(), baseRate, start, end));
});

api.post('/bookings', (req, res) => {
  const { checkIn, checkOut, guest } = req.body as { checkIn: string; checkOut: string; guest: string };
  if (!isValidDate(checkIn) || !isValidDate(checkOut) || !guest) {
    return res.status(400).json({ error: 'checkIn, checkOut (YYYY-MM-DD) and guest are required.' });
  }
  const { baseRate } = store.getProperty();
  const overrides = store.getAllOverrides();
  const bookingId = randomUUID();
  const result = createBooking(overrides, baseRate, checkIn, checkOut, guest, bookingId);
  if (!result.ok) {
    const status = result.reason === 'overlap' ? 409 : 400;
    return res.status(status).json({ error: result.error, reason: result.reason });
  }
  store.saveOverrides(result.updates ?? []);
  return res.status(201).json({ bookingId, days: buildCalendarRange(store.getAllOverrides(), baseRate, checkIn, checkOut) });
});

api.delete('/bookings/:bookingId', (req, res) => {
  const { bookingId } = req.params;
  const overrides = store.getAllOverrides();
  const result = cancelBooking(overrides, bookingId);
  if (!result.ok) {
    return res.status(404).json({ error: result.error });
  }
  store.saveOverrides(result.updates ?? []);
  return res.json({ ok: true });
});

api.post('/import', (req, res) => {
  const reservations = req.body as ImportReservation[];
  if (!Array.isArray(reservations)) {
    return res.status(400).json({ error: 'Request body must be an array of reservations.' });
  }
  const { baseRate } = store.getProperty();
  const overrides = store.getAllOverrides();
  const alreadyImportedIds = store.getImportedIds();

  const result = reconcileReservations(overrides, baseRate, alreadyImportedIds, reservations);

  store.saveOverrides(result.updates);
  store.recordImported(
    result.imported.map((id) => {
      const reservation = reservations.find((entry) => entry.id === id)!;
      return { id, checkIn: reservation.checkIn, checkOut: reservation.checkOut, guest: reservation.guest };
    })
  );

  return res.json({
    summary: {
      imported: result.imported,
      duplicatesInFeed: result.duplicatesInFeed,
      alreadyImported: result.alreadyImported,
      cancelled: result.cancelled,
      conflicts: result.conflicts
    }
  });
});

app.use('/api', api);

const port = Number(process.env.PORT || 3100);
// Binding to a specific host (e.g. 127.0.0.1) makes the server unreachable
// from outside its own container — Vercel (and most PaaS hosts) need it
// listening on all interfaces to route external traffic in.
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
