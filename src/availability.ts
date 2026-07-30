export type DayStatus = 'available' | 'booked' | 'blocked';

export interface CalendarDay {
  date: string;
  rate: number;
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
  updatedDays?: CalendarDay[];
}

export interface ReconcileResult {
  imported: number;
  duplicates: number;
  cancelled: number;
  conflicts: number;
}

const dayMs = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function getDatesBetweenInclusive(start: string, end: string): string[] {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    cursor = new Date(cursor.getTime() + dayMs);
  }
  return dates;
}

function getDatesBetweenExclusive(start: string, end: string): string[] {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor < endDate) {
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    cursor = new Date(cursor.getTime() + dayMs);
  }
  return dates;
}

export function createBooking(days: CalendarDay[], start: string, end: string, guest: string): BookingResult {
  const targetDates = getDatesBetweenInclusive(start, end);
  const overlaps = targetDates.some((date) => {
    const day = days.find((entry) => entry.date === date);
    return !day || day.status !== 'available';
  });

  if (overlaps) {
    return { ok: false, error: 'Booking overlaps with an existing booking or block.' };
  }

  const updatedDays = days.map((day) => {
    if (targetDates.includes(day.date)) {
      return { ...day, status: 'booked' as DayStatus, bookingGuest: guest, bookingId: `booking-${guest}-${day.date}` };
    }
    return day;
  });

  return { ok: true, updatedDays };
}

export function setRateOverride(days: CalendarDay[], start: string, end: string, rate: number): CalendarDay[] {
  return days.map((day) => {
    if (getDatesBetweenInclusive(start, end).includes(day.date)) {
      return { ...day, rate };
    }
    return day;
  });
}

export function setBlockStatus(days: CalendarDay[], start: string, end: string, blocked: boolean): CalendarDay[] {
  return days.map((day) => {
    if (getDatesBetweenInclusive(start, end).includes(day.date)) {
      const nextStatus: DayStatus = blocked ? 'blocked' : 'available';
      return { ...day, status: nextStatus };
    }
    return day;
  });
}

export function reconcileReservations(days: CalendarDay[], reservations: ImportReservation[]): ReconcileResult {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const imported: ImportReservation[] = [];

  for (const reservation of reservations) {
    if (reservation.status === 'cancelled') {
      continue;
    }
    if (seen.has(reservation.id)) {
      duplicates.add(reservation.id);
      continue;
    }
    seen.add(reservation.id);
    imported.push(reservation);
  }

  const conflictIds = new Set<string>();
  const nextDays = [...days];

  for (const reservation of imported) {
    const targetDates = getDatesBetweenExclusive(reservation.checkIn, reservation.checkOut);
    const conflict = targetDates.some((date) => {
      const day = nextDays.find((entry) => entry.date === date);
      return day?.status === 'booked' || day?.status === 'blocked';
    });

    if (conflict) {
      conflictIds.add(reservation.id);
      continue;
    }

    for (const date of targetDates) {
      const existing = nextDays.find((entry) => entry.date === date);
      if (existing) {
        existing.status = 'booked';
        existing.bookingId = reservation.id;
        existing.bookingGuest = reservation.guest;
      } else {
        nextDays.push({ date, rate: 120, status: 'booked', bookingId: reservation.id, bookingGuest: reservation.guest });
      }
    }
  }

  return {
    imported: imported.length - conflictIds.size,
    duplicates: duplicates.size,
    cancelled: reservations.filter((reservation) => reservation.status === 'cancelled').length,
    conflicts: conflictIds.size
  };
}
