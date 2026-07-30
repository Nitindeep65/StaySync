import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking, reconcileReservations, setRateOverride, setBlockStatus, type CalendarDay, type ImportReservation } from '../src/availability';

test('rate overrides are applied across a date range', () => {
  const days: CalendarDay[] = [
    { date: '2026-08-01', rate: 120, status: 'available' },
    { date: '2026-08-02', rate: 120, status: 'available' },
    { date: '2026-08-03', rate: 120, status: 'available' }
  ];

  const updated = setRateOverride(days, '2026-08-01', '2026-08-02', 150);

  assert.equal(updated[0].rate, 150);
  assert.equal(updated[1].rate, 150);
  assert.equal(updated[2].rate, 120);
});

test('bookings reject overlaps with blocks or existing bookings', () => {
  const days: CalendarDay[] = [
    { date: '2026-08-01', rate: 120, status: 'available' },
    { date: '2026-08-02', rate: 120, status: 'blocked' },
    { date: '2026-08-03', rate: 120, status: 'available' }
  ];

  const result = createBooking(days, '2026-08-01', '2026-08-03', 'Guest');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /overlap/i);
});

test('reconciliation dedupes, cancels, and respects exclusive checkout semantics', () => {
  const days: CalendarDay[] = [];
  const reservations: ImportReservation[] = [
    { id: '1001', guest: 'John D.', checkIn: '2026-08-10', checkOut: '2026-08-12' },
    { id: '1002', guest: 'Maria S.', checkIn: '2026-08-15', checkOut: '2026-08-17' },
    { id: '1001', guest: 'John D.', checkIn: '2026-08-10', checkOut: '2026-08-12' },
    { id: '0999', guest: '—', checkIn: '2026-08-01', checkOut: '2026-08-02', status: 'cancelled' },
    { id: '1003', guest: 'Sam P.', checkIn: '2026-08-13', checkOut: '2026-08-15' }
  ];

  const result = reconcileReservations(days, reservations);

  assert.equal(result.imported, 3);
  assert.equal(result.duplicates, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.conflicts, 0);
});
