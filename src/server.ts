import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createBooking, setRateOverride, setBlockStatus, reconcileReservations, type CalendarDay, type ImportReservation } from './availability';

const app = express();
app.use(cors());
app.use(express.json());

const baseRate = 120;
const initialDays: CalendarDay[] = Array.from({ length: 31 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 1 + index));
  return { date: date.toISOString().slice(0, 10), rate: baseRate, status: 'available' };
});

let calendar = [...initialDays];

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/calendar', (_req, res) => {
  res.json(calendar);
});

app.post('/rate', (req, res) => {
  const { start, end, rate } = req.body as { start: string; end: string; rate: number };
  calendar = setRateOverride(calendar, start, end, rate);
  res.json(calendar);
});

app.post('/block', (req, res) => {
  const { start, end, blocked } = req.body as { start: string; end: string; blocked: boolean };
  calendar = setBlockStatus(calendar, start, end, blocked);
  res.json(calendar);
});

app.post('/bookings', (req, res) => {
  const { start, end, guest } = req.body as { start: string; end: string; guest: string };
  const result = createBooking(calendar, start, end, guest);
  if (!result.ok) {
    return res.status(409).json({ error: result.error });
  }
  calendar = result.updatedDays ?? calendar;
  return res.json(calendar);
});

app.post('/import', (req, res) => {
  const reservations = req.body as ImportReservation[];
  const result = reconcileReservations(calendar, reservations);
  res.json({ result, calendar });
});

app.get('/', (_req, res) => {
  res.send(readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8'));
});

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

const port = Number(process.env.PORT || 3100);
app.listen(port, '127.0.0.1', () => {
  console.log(`Server listening on http://127.0.0.1:${port}`);
});
