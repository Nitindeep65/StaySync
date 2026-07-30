import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBlockStatus,
  applyRateOverride,
  buildCalendarRange,
  createBooking,
  reconcileReservations,
  type DayRecord,
  type ImportReservation
} from '../src/availability';

const baseRate = 120;

test('rate overrides apply across an inclusive date range and leave other days alone', () => {
  const overrides = new Map<string, DayRecord>();
  const updates = applyRateOverride(overrides, baseRate, '2026-08-01', '2026-08-02', 150);
  for (const update of updates) overrides.set(update.date, update);

  const range = buildCalendarRange(overrides, baseRate, '2026-08-01', '2026-08-03');
  assert.equal(range[0].rate, 150);
  assert.equal(range[1].rate, 150);
  assert.equal(range[2].rate, baseRate);
});

test('blocking rejects when a day in range is already booked', () => {
  const overrides = new Map<string, DayRecord>([
    ['2026-08-02', { date: '2026-08-02', rate: null, status: 'booked', bookingId: 'b1', bookingGuest: 'Guest' }]
  ]);

  const result = applyBlockStatus(overrides, baseRate, '2026-08-01', '2026-08-03', true);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /booked/i);
});

test('unblocking only clears currently-blocked days, leaving booked days untouched', () => {
  const overrides = new Map<string, DayRecord>([
    ['2026-08-01', { date: '2026-08-01', rate: null, status: 'blocked' }],
    ['2026-08-02', { date: '2026-08-02', rate: null, status: 'booked', bookingId: 'b1', bookingGuest: 'Guest' }]
  ]);

  const result = applyBlockStatus(overrides, baseRate, '2026-08-01', '2026-08-02', false);
  assert.equal(result.ok, true);
  assert.equal(result.updates?.length, 1);
  assert.equal(result.updates?.[0].date, '2026-08-01');
  assert.equal(result.updates?.[0].status, 'available');
});

test('bookings use exclusive checkout: checkIn..checkOut-1 nights', () => {
  const overrides = new Map<string, DayRecord>();
  const result = createBooking(overrides, baseRate, '2026-08-10', '2026-08-12', 'Guest', 'booking-1');
  assert.equal(result.ok, true);
  const dates = result.updates?.map((d) => d.date);
  assert.deepEqual(dates, ['2026-08-10', '2026-08-11']);
});

test('bookings reject overlaps with existing bookings or blocks', () => {
  const overrides = new Map<string, DayRecord>([
    ['2026-08-02', { date: '2026-08-02', rate: null, status: 'blocked' }]
  ]);

  const result = createBooking(overrides, baseRate, '2026-08-01', '2026-08-03', 'Guest', 'booking-2');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /overlap/i);
});

const feed: ImportReservation[] = [
  { id: '1001', guest: 'John D.', checkIn: '2026-08-10', checkOut: '2026-08-12' },
  { id: '1002', guest: 'Maria S.', checkIn: '2026-08-15', checkOut: '2026-08-18' },
  { id: '1001', guest: 'John D.', checkIn: '2026-08-10', checkOut: '2026-08-12' },
  { id: '0999', guest: '—', checkIn: '2026-08-01', checkOut: '2026-08-03', status: 'cancelled' },
  { id: '1003', guest: 'Sam P.', checkIn: '2026-08-13', checkOut: '2026-08-16' }
];

test('reconciliation dedupes, skips cancellations, and rejects a real cross-reservation conflict', () => {
  const overrides = new Map<string, DayRecord>();
  const result = reconcileReservations(overrides, baseRate, new Set(), feed);

  assert.deepEqual(result.imported, ['1001', '1002']);
  assert.deepEqual(result.duplicatesInFeed, ['1001']);
  assert.deepEqual(result.cancelled, ['0999']);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].id, '1003');
  assert.match(result.conflicts[0].reason, /2026-08-15/);
});

test('re-running the same import is idempotent: previously-imported ids are skipped, not re-booked', () => {
  const overrides = new Map<string, DayRecord>();
  const first = reconcileReservations(overrides, baseRate, new Set(), feed);
  for (const update of first.updates) overrides.set(update.date, update);
  const alreadyImported = new Set(first.imported);

  const second = reconcileReservations(overrides, baseRate, alreadyImported, feed);

  assert.deepEqual(second.imported, []);
  assert.deepEqual(second.alreadyImported, ['1001', '1002']);
  assert.equal(second.updates.length, 0);
  // 1003 still genuinely conflicts on re-run — it was never imported.
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.conflicts[0].id, '1003');
});
