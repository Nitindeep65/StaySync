import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { DayRecord, DayStatus } from './availability';

export interface Property {
  name: string;
  baseRate: number;
}

export class CalendarStore {
  private db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.seedProperty();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS property (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        base_rate REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS day_overrides (
        date TEXT PRIMARY KEY,
        rate REAL,
        status TEXT NOT NULL DEFAULT 'available',
        booking_id TEXT,
        booking_guest TEXT
      );

      CREATE TABLE IF NOT EXISTS imported_reservations (
        id TEXT PRIMARY KEY,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        guest TEXT,
        imported_at TEXT NOT NULL
      );
    `);
  }

  private seedProperty(): void {
    const existing = this.db.prepare('SELECT id FROM property WHERE id = 1').get();
    if (!existing) {
      this.db.prepare('INSERT INTO property (id, name, base_rate) VALUES (1, ?, ?)').run('Seaside Cottage', 120);
    }
  }

  getProperty(): Property {
    const row = this.db.prepare('SELECT name, base_rate as baseRate FROM property WHERE id = 1').get() as {
      name: string;
      baseRate: number;
    };
    return row;
  }

  /** Loads every stored override — booking/conflict checks must see the whole calendar, not just a queried range. */
  getAllOverrides(): Map<string, DayRecord> {
    const rows = this.db
      .prepare('SELECT date, rate, status, booking_id as bookingId, booking_guest as bookingGuest FROM day_overrides')
      .all() as Array<{ date: string; rate: number | null; status: DayStatus; bookingId: string | null; bookingGuest: string | null }>;

    const map = new Map<string, DayRecord>();
    for (const row of rows) {
      map.set(row.date, {
        date: row.date,
        rate: row.rate,
        status: row.status,
        ...(row.bookingId ? { bookingId: row.bookingId } : {}),
        ...(row.bookingGuest ? { bookingGuest: row.bookingGuest } : {})
      });
    }
    return map;
  }

  saveOverrides(records: DayRecord[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO day_overrides (date, rate, status, booking_id, booking_guest)
      VALUES (@date, @rate, @status, @bookingId, @bookingGuest)
      ON CONFLICT(date) DO UPDATE SET
        rate = excluded.rate,
        status = excluded.status,
        booking_id = excluded.booking_id,
        booking_guest = excluded.booking_guest
    `);
    const tx = this.db.transaction((rows: DayRecord[]) => {
      for (const row of rows) {
        upsert.run({
          date: row.date,
          rate: row.rate ?? null,
          status: row.status,
          bookingId: row.bookingId ?? null,
          bookingGuest: row.bookingGuest ?? null
        });
      }
    });
    tx(records);
  }

  getImportedIds(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM imported_reservations').all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  recordImported(ids: Array<{ id: string; checkIn: string; checkOut: string; guest: string }>): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO imported_reservations (id, check_in, check_out, guest, imported_at)
      VALUES (@id, @checkIn, @checkOut, @guest, @importedAt)
    `);
    const tx = this.db.transaction((rows: typeof ids) => {
      for (const row of rows) {
        insert.run({ ...row, importedAt: new Date().toISOString() });
      }
    });
    tx(ids);
  }

  close(): void {
    this.db.close();
  }
}
