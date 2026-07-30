export type DayStatus = 'available' | 'booked' | 'blocked';

export interface CalendarDay {
  date: string;
  rate: number;
  status: DayStatus;
  bookingGuest?: string;
}

export interface Property {
  name: string;
  baseRate: number;
}

export interface ConflictDetail {
  id: string;
  reason: string;
}

export interface ImportSummary {
  imported: string[];
  duplicatesInFeed: string[];
  alreadyImported: string[];
  cancelled: string[];
  conflicts: ConflictDetail[];
}

export interface ImportReservation {
  id: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  status?: 'confirmed' | 'cancelled';
}
