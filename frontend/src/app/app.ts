import { Component, computed, HostListener, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ApiError } from './api';
import { CalendarDay, ImportReservation, ImportSummary } from './models';

interface DayCell {
  date: string;
  inMonth: boolean;
  day?: CalendarDay;
}

interface BookingSummary {
  bookingId: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  nights: number;
}

interface StatusMessage {
  kind: 'error' | 'success' | 'info';
  text: string;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MOCK_FEED: ImportReservation[] = [
  { id: '1001', guest: 'John D.', checkIn: '2026-08-10', checkOut: '2026-08-12' },
  { id: '1002', guest: 'Maria S.', checkIn: '2026-08-15', checkOut: '2026-08-18' },
  { id: '1001', guest: 'John D.', checkIn: '2026-08-10', checkOut: '2026-08-12' },
  { id: '0999', guest: '—', checkIn: '2026-08-01', checkOut: '2026-08-03', status: 'cancelled' },
  { id: '1003', guest: 'Sam P.', checkIn: '2026-08-13', checkOut: '2026-08-16' }
];

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly weekdayLabels = WEEKDAY_LABELS;

  protected readonly baseRate = signal(120);
  protected readonly weekendMultiplier = signal(1.25);
  protected readonly minStayNights = signal(2);
  protected readonly viewYear = signal(2026);
  protected readonly viewMonth = signal(7); // 0-indexed: August

  private readonly daysByDate = signal<Map<string, CalendarDay>>(new Map());

  protected readonly weekendUpliftPercent = computed(() => Math.round((this.weekendMultiplier() - 1) * 100));

  protected readonly monthLabel = computed(() => {
    const d = new Date(Date.UTC(this.viewYear(), this.viewMonth(), 1));
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  });

  protected readonly weeks = computed<DayCell[][]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const map = this.daysByDate();

    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const leadingBlanks = firstOfMonth.getUTCDay();

    const cells: DayCell[] = [];
    for (let i = 0; i < leadingBlanks; i++) {
      const d = new Date(Date.UTC(year, month, 1 - (leadingBlanks - i)));
      cells.push({ date: toIso(d), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIso(new Date(Date.UTC(year, month, day)));
      cells.push({ date: iso, inMonth: true, day: map.get(iso) });
    }
    while (cells.length % 7 !== 0) {
      const last = parseIso(cells[cells.length - 1].date);
      const d = new Date(last.getTime() + 86400000);
      cells.push({ date: toIso(d), inMonth: false });
    }

    const weeks: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

  /**
   * Groups consecutive booked nights sharing a bookingId into one row, so
   * the sidebar list reads "Guest, checkIn → checkOut" instead of one line
   * per night. Scoped to the currently-loaded month's range.
   */
  protected readonly bookingsThisMonth = computed<BookingSummary[]>(() => {
    const map = this.daysByDate();
    const dates = [...map.keys()].sort();
    const result: BookingSummary[] = [];
    let current: { bookingId: string; guest: string; checkIn: string; lastDate: string } | null = null;

    const flush = () => {
      if (!current) return;
      const checkOut = toIso(new Date(parseIso(current.lastDate).getTime() + 86400000));
      const nights = Math.round((parseIso(checkOut).getTime() - parseIso(current.checkIn).getTime()) / 86400000);
      result.push({ bookingId: current.bookingId, guest: current.guest, checkIn: current.checkIn, checkOut, nights });
      current = null;
    };

    for (const date of dates) {
      const day = map.get(date)!;
      const isBooked = day.status === 'booked' && day.bookingId;
      if (isBooked) {
        const isContinuation =
          current && current.bookingId === day.bookingId && toIso(new Date(parseIso(current.lastDate).getTime() + 86400000)) === date;
        if (isContinuation) {
          current!.lastDate = date;
        } else {
          flush();
          current = { bookingId: day.bookingId!, guest: day.bookingGuest ?? 'Guest', checkIn: date, lastDate: date };
        }
      } else {
        flush();
      }
    }
    flush();

    return result.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  });

  protected rangeStart = signal<string | null>(null);
  protected rangeEnd = signal<string | null>(null);
  protected readonly rangeLabel = computed(() => {
    if (!this.rangeStart()) return 'Click a day, then click another to select a range — also fills the booking form below.';
    if (!this.rangeEnd()) return `Start: ${this.rangeStart()} — click an end day (or the same day again).`;
    return `Selected: ${this.rangeStart()} to ${this.rangeEnd()}`;
  });

  protected rateValue = signal(120);
  protected bookingCheckIn = signal('');
  protected bookingCheckOut = signal('');
  protected bookingGuest = signal('');

  protected status = signal<StatusMessage | null>(null);
  protected importSummary = signal<ImportSummary | null>(null);
  protected loading = signal(false);
  protected helpOpen = signal(false);

  constructor(private api: Api) {}

  ngOnInit(): void {
    this.api.getProperty().subscribe({
      next: (property) => {
        this.baseRate.set(property.baseRate);
        this.rateValue.set(property.baseRate);
        this.weekendMultiplier.set(property.pricing.weekendMultiplier);
        this.minStayNights.set(property.pricing.minStayNights);
      },
      error: () => {}
    });
    this.loadMonth();
  }

  private monthBounds(): { start: string; end: string } {
    const year = this.viewYear();
    const month = this.viewMonth();
    const start = toIso(new Date(Date.UTC(year, month, 1)));
    const end = toIso(new Date(Date.UTC(year, month + 1, 0)));
    return { start, end };
  }

  protected loadMonth(): void {
    const { start, end } = this.monthBounds();
    this.loading.set(true);
    this.api.getCalendar(start, end).subscribe({
      next: (days) => {
        this.daysByDate.set(new Map(days.map((d) => [d.date, d])));
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.setError(err.message);
        this.loading.set(false);
      }
    });
  }

  protected prevMonth(): void {
    const m = this.viewMonth() - 1;
    if (m < 0) {
      this.viewYear.update((y) => y - 1);
      this.viewMonth.set(11);
    } else {
      this.viewMonth.set(m);
    }
    this.clearSelection();
    this.loadMonth();
  }

  protected nextMonth(): void {
    const m = this.viewMonth() + 1;
    if (m > 11) {
      this.viewYear.update((y) => y + 1);
      this.viewMonth.set(0);
    } else {
      this.viewMonth.set(m);
    }
    this.clearSelection();
    this.loadMonth();
  }

  protected onDayClick(cell: DayCell): void {
    if (!cell.inMonth) return;
    if (!this.rangeStart() || this.rangeEnd()) {
      this.rangeStart.set(cell.date);
      this.rangeEnd.set(null);
    } else if (cell.date < this.rangeStart()!) {
      this.rangeEnd.set(this.rangeStart());
      this.rangeStart.set(cell.date);
    } else {
      this.rangeEnd.set(cell.date);
    }
    this.syncBookingFieldsFromSelection();
  }

  /**
   * Clicking the calendar picks the manual check-in/check-out fields too, so
   * the user doesn't have to retype dates they just clicked. The selected
   * days are treated as the nights to stay (inclusive), so check-out is
   * auto-set to the day *after* the last clicked day — matching the
   * exclusive-checkout convention the booking API expects.
   */
  private syncBookingFieldsFromSelection(): void {
    const start = this.rangeStart();
    if (!start) return;
    const end = this.rangeEnd() ?? start;
    this.bookingCheckIn.set(start);
    this.bookingCheckOut.set(toIso(new Date(parseIso(end).getTime() + 86400000)));
  }

  protected isInSelection(date: string): boolean {
    const start = this.rangeStart();
    const end = this.rangeEnd() ?? this.rangeStart();
    if (!start || !end) return false;
    return date >= start && date <= end;
  }

  protected clearSelection(): void {
    this.rangeStart.set(null);
    this.rangeEnd.set(null);
  }

  protected applyRate(): void {
    const start = this.rangeStart();
    const end = this.rangeEnd() ?? start;
    if (!start || !end) {
      this.setError('Select a date range on the calendar first.');
      return;
    }
    this.api.setRate(start, end!, this.rateValue()).subscribe({
      next: () => {
        this.setSuccess(`Rate set to £${this.rateValue()} for ${start} – ${end}.`);
        this.clearSelection();
        this.loadMonth();
      },
      error: (err: ApiError) => this.setError(err.message)
    });
  }

  protected applyBlock(blocked: boolean): void {
    const start = this.rangeStart();
    const end = this.rangeEnd() ?? start;
    if (!start || !end) {
      this.setError('Select a date range on the calendar first.');
      return;
    }
    this.api.setBlock(start, end!, blocked).subscribe({
      next: () => {
        this.setSuccess(`${blocked ? 'Blocked' : 'Unblocked'} ${start} – ${end}.`);
        this.clearSelection();
        this.loadMonth();
      },
      error: (err: ApiError) => this.setError(err.message)
    });
  }

  protected submitBooking(): void {
    const checkIn = this.bookingCheckIn();
    const checkOut = this.bookingCheckOut();
    const guest = this.bookingGuest().trim();
    if (!checkIn || !checkOut || !guest) {
      this.setError('Check-in, check-out, and guest name are all required.');
      return;
    }
    this.api.createBooking(checkIn, checkOut, guest).subscribe({
      next: () => {
        this.setSuccess(`Booked for ${guest}: ${checkIn} to ${checkOut} (checkout night not charged).`);
        this.bookingCheckIn.set('');
        this.bookingCheckOut.set('');
        this.bookingGuest.set('');
        this.clearSelection();
        this.loadMonth();
      },
      error: (err: ApiError) => {
        // Graceful handling: a 409 clash is an expected outcome, not a crash — surface it inline.
        if (err.status === 409) {
          this.setError(`Those dates aren't available: ${err.message}`);
        } else {
          this.setError(err.message);
        }
      }
    });
  }

  protected importMockFeed(): void {
    this.api.importFeed(MOCK_FEED).subscribe({
      next: ({ summary }) => {
        this.importSummary.set(summary);
        this.setSuccess('Channel feed reconciled.');
        this.loadMonth();
      },
      error: (err: ApiError) => this.setError(err.message)
    });
  }

  private setError(text: string): void {
    this.status.set({ kind: 'error', text });
  }

  private setSuccess(text: string): void {
    this.status.set({ kind: 'success', text });
  }

  protected dismissStatus(): void {
    this.status.set(null);
  }

  protected openHelp(): void {
    this.helpOpen.set(true);
  }

  protected closeHelp(): void {
    this.helpOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscapeKey(): void {
    if (this.helpOpen()) this.closeHelp();
  }
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIso(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
