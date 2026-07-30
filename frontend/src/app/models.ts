export type DayStatus = 'available' | 'booked' | 'blocked';

export interface CalendarDay {
  date: string;
  rate: number;
  status: DayStatus;
  bookingId?: string;
  bookingGuest?: string;
}

export interface PricingRules {
  weekendMultiplier: number;
  minStayNights: number;
}

export interface Property {
  name: string;
  baseRate: number;
  pricing: PricingRules;
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
