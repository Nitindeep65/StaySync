export type DayStatus = 'available' | 'booked' | 'blocked';

export interface DayRecord {
  date: string;
  rate: number | null;
  status: DayStatus;
  bookingId?: string;
  bookingGuest?: string;
}

export interface ImportReservation {
  id: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  status?: 'confirmed' | 'cancelled';
}

export interface BookingResult {
  ok: boolean;
  error?: string;
  updates?: DayRecord[];
}

export interface BlockResult {
  ok: boolean;
  error?: string;
  updates?: DayRecord[];
}

export interface ConflictDetail {
  id: string;
  reason: string;
}

export interface ReconcileResult {
  imported: string[];
  duplicatesInFeed: string[];
  alreadyImported: string[];
  cancelled: string[];
  conflicts: ConflictDetail[];
  updates: DayRecord[];
}

const dayMs = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive on both ends — used for calendar-cell operations (rates, blocks). */
export function datesInclusive(start: string, end: string): string[] {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = new Date(cursor.getTime() + dayMs)) {
    dates.push(toIso(cursor));
  }
  return dates;
}

/** checkOut is exclusive — the industry convention for stays (checkIn .. checkOut - 1 night). */
export function nightsOfStay(checkIn: string, checkOut: string): string[] {
  const startDate = parseDate(checkIn);
  const endDate = parseDate(checkOut);
  const dates: string[] = [];
  for (let cursor = startDate; cursor < endDate; cursor = new Date(cursor.getTime() + dayMs)) {
    dates.push(toIso(cursor));
  }
  return dates;
}

function getDay(overrides: Map<string, DayRecord>, baseRate: number, date: string): DayRecord {
  return overrides.get(date) ?? { date, rate: null, status: 'available' };
}

export function effectiveRate(day: DayRecord, baseRate: number): number {
  return day.rate ?? baseRate;
}

export function buildCalendarRange(
  overrides: Map<string, DayRecord>,
  baseRate: number,
  start: string,
  end: string
): Array<{ date: string; rate: number; status: DayStatus; bookingGuest?: string }> {
  return datesInclusive(start, end).map((date) => {
    const day = getDay(overrides, baseRate, date);
    return {
      date,
      rate: effectiveRate(day, baseRate),
      status: day.status,
      ...(day.bookingGuest ? { bookingGuest: day.bookingGuest } : {})
    };
  });
}

export function applyRateOverride(
  overrides: Map<string, DayRecord>,
  baseRate: number,
  start: string,
  end: string,
  rate: number
): DayRecord[] {
  return datesInclusive(start, end).map((date) => {
    const day = getDay(overrides, baseRate, date);
    return { ...day, rate };
  });
}

export function applyBlockStatus(
  overrides: Map<string, DayRecord>,
  baseRate: number,
  start: string,
  end: string,
  blocked: boolean
): BlockResult {
  const dates = datesInclusive(start, end);

  if (blocked) {
    const bookedDates = dates.filter((date) => getDay(overrides, baseRate, date).status === 'booked');
    if (bookedDates.length > 0) {
      return { ok: false, error: `Cannot block ${bookedDates[0]}: already booked.` };
    }
    const updates = dates.map((date) => ({ ...getDay(overrides, baseRate, date), status: 'blocked' as DayStatus }));
    return { ok: true, updates };
  }

  // Unblocking only affects currently-blocked days; booked/available days are left untouched.
  const updates = dates
    .map((date) => getDay(overrides, baseRate, date))
    .filter((day) => day.status === 'blocked')
    .map((day) => ({ ...day, status: 'available' as DayStatus }));
  return { ok: true, updates };
}

export function createBooking(
  overrides: Map<string, DayRecord>,
  baseRate: number,
  checkIn: string,
  checkOut: string,
  guest: string,
  bookingId: string
): BookingResult {
  const nights = nightsOfStay(checkIn, checkOut);
  if (nights.length === 0) {
    return { ok: false, error: 'checkOut must be after checkIn.' };
  }

  const unavailable = nights.find((date) => getDay(overrides, baseRate, date).status !== 'available');
  if (unavailable) {
    return { ok: false, error: `Booking overlaps with an existing booking or block on ${unavailable}.` };
  }

  const updates = nights.map((date) => ({
    ...getDay(overrides, baseRate, date),
    status: 'booked' as DayStatus,
    bookingId,
    bookingGuest: guest
  }));

  return { ok: true, updates };
}

/**
 * Reconciles a channel feed against current calendar state.
 *
 * Decisions (see README for full rationale):
 * - Dedupe by reservation id, first occurrence in the feed wins.
 * - status: 'cancelled' entries are skipped, never booked.
 * - Conflicts are checked against both the persisted calendar AND earlier
 *   reservations already accepted from the same feed (first-come-first-served).
 * - Reservation ids already imported in a previous call are skipped as
 *   'alreadyImported' rather than re-processed, so re-running an import is a no-op.
 */
export function reconcileReservations(
  overrides: Map<string, DayRecord>,
  baseRate: number,
  alreadyImportedIds: Set<string>,
  reservations: ImportReservation[]
): ReconcileResult {
  const seenInFeed = new Set<string>();
  const duplicatesInFeed: string[] = [];
  const cancelled: string[] = [];
  const alreadyImported: string[] = [];
  const conflicts: ConflictDetail[] = [];
  const imported: string[] = [];
  const updates: DayRecord[] = [];

  // Working copy so nights booked earlier in this same batch count toward later conflict checks.
  const working = new Map(overrides);

  for (const reservation of reservations) {
    if (reservation.status === 'cancelled') {
      cancelled.push(reservation.id);
      continue;
    }

    if (seenInFeed.has(reservation.id)) {
      duplicatesInFeed.push(reservation.id);
      continue;
    }
    seenInFeed.add(reservation.id);

    if (alreadyImportedIds.has(reservation.id)) {
      alreadyImported.push(reservation.id);
      continue;
    }

    const nights = nightsOfStay(reservation.checkIn, reservation.checkOut);
    const conflictDate = nights.find((date) => getDay(working, baseRate, date).status !== 'available');
    if (conflictDate) {
      conflicts.push({ id: reservation.id, reason: `night ${conflictDate} already booked or blocked` });
      continue;
    }

    for (const date of nights) {
      const day = getDay(working, baseRate, date);
      const updated: DayRecord = {
        ...day,
        status: 'booked',
        bookingId: reservation.id,
        bookingGuest: reservation.guest
      };
      working.set(date, updated);
      updates.push(updated);
    }
    imported.push(reservation.id);
  }

  return { imported, duplicatesInFeed, alreadyImported, cancelled, conflicts, updates };
}
