import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { environment } from '../environments/environment';
import { CalendarDay, ImportReservation, ImportSummary, Property } from './models';

export interface ApiError {
  status: number;
  message: string;
}

const API_BASE = environment.apiBase;

@Injectable({ providedIn: 'root' })
export class Api {
  constructor(private http: HttpClient) {}

  getProperty(): Observable<Property> {
    return this.http.get<Property>(`${API_BASE}/property`).pipe(catchError(toApiError));
  }

  getCalendar(start: string, end: string): Observable<CalendarDay[]> {
    return this.http
      .get<CalendarDay[]>(`${API_BASE}/calendar`, { params: { start, end } })
      .pipe(catchError(toApiError));
  }

  setRate(start: string, end: string, rate: number): Observable<CalendarDay[]> {
    return this.http.post<CalendarDay[]>(`${API_BASE}/rate`, { start, end, rate }).pipe(catchError(toApiError));
  }

  setBlock(start: string, end: string, blocked: boolean): Observable<CalendarDay[]> {
    return this.http.post<CalendarDay[]>(`${API_BASE}/block`, { start, end, blocked }).pipe(catchError(toApiError));
  }

  createBooking(checkIn: string, checkOut: string, guest: string): Observable<{ bookingId: string; days: CalendarDay[] }> {
    return this.http
      .post<{ bookingId: string; days: CalendarDay[] }>(`${API_BASE}/bookings`, { checkIn, checkOut, guest })
      .pipe(catchError(toApiError));
  }

  importFeed(reservations: ImportReservation[]): Observable<{ summary: ImportSummary }> {
    return this.http
      .post<{ summary: ImportSummary }>(`${API_BASE}/import`, reservations)
      .pipe(catchError(toApiError));
  }

  deleteBooking(bookingId: string): Observable<{ ok: boolean }> {
    return this.http
      .delete<{ ok: boolean }>(`${API_BASE}/bookings/${encodeURIComponent(bookingId)}`)
      .pipe(catchError(toApiError));
  }
}

function toApiError(err: HttpErrorResponse) {
  const message = err.error?.error || err.message || 'Something went wrong.';
  const apiError: ApiError = { status: err.status, message };
  return throwError(() => apiError);
}
