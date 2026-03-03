import React, { useContext, useEffect, useState } from 'react';
import { UiContext } from '../App.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { formatDisplayDate } from '../utils/dateFormat.js';

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAllDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toLocalDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const time = timeStr || '00:00';
  const dt = new Date(`${dateStr}T${time}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function buildRange({ fromDate, toDate, fromTime, toTime }) {
  const from = toLocalDateTime(fromDate, fromTime || '00:00');
  let to = toLocalDateTime(toDate, toTime || '00:00');

  if (from && to && fromDate === toDate && (toTime || '00:00') === '00:00') {
    const next = new Date(to);
    next.setDate(next.getDate() + 1);
    to = next;
  }

  if (from && to && from >= to) {
    return { from, to, error: 'From date/time must be before To date/time.' };
  }

  return { from, to, error: null };
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  if (diff <= 0) return null;
  return Math.round(diff / 60000);
}

function extractLabeledValue(text, label) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`\\b${label}\\b\\s*[:\\-]\\s*(.+)$`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function extractPatientAndTreatment(event) {
  const summary = event.summary || '';
  const description = event.description || '';

  const patientFromDesc = extractLabeledValue(description, 'patient');
  const treatmentFromDesc = extractLabeledValue(description, 'treatment');
  const patientFromSummary = extractLabeledValue(summary, 'patient');
  const treatmentFromSummary = extractLabeledValue(summary, 'treatment');

  let patient = patientFromDesc || patientFromSummary;
  let treatment = treatmentFromDesc || treatmentFromSummary;

  if (!patient || !treatment) {
    const parts = String(summary).split(/\s*[-|]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      patient = patient || parts[0];
      treatment = treatment || parts.slice(1).join(' - ');
    }
  }

  return {
    patientName: patient || summary || '',
    treatmentType: treatment || '',
  };
}

function formatDate(value) {
  if (!value) return 'N/A';
  if (isAllDay(value)) return formatDisplayDate(value, { includeTime: false, fallback: 'N/A' });
  return formatDisplayDate(value, { fallback: 'N/A' });
}

export default function SearchPage() {
  const { searchQuery, setSearchQuery, refreshTick } = useContext(UiContext);
  const [events, setEvents] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterOpen, setFilterOpen] = useState(true);
  const [filters, setFilters] = useState({
    searchText: '',
    slotDuration: 'all',
    customDuration: '45',
    fromDate: '',
    toDate: '',
    fromTime: '00:00',
    toTime: '00:00',
    sortBy: 'startAsc',
  });
  const [appliedFilters, setAppliedFilters] = useState({
    searchText: '',
    slotDuration: 'all',
    customDuration: '45',
    fromDate: '',
    toDate: '',
    fromTime: '00:00',
    toTime: '00:00',
    sortBy: 'startAsc',
  });
  const [filterError, setFilterError] = useState('');
  const [lastFetchKey, setLastFetchKey] = useState('');

  useEffect(() => {
    setFilters((prev) => ({ ...prev, searchText: searchQuery }));
  }, [searchQuery]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const resp = await fetch('/api/events?maxResults=100');
      const data = await resp.json().catch(() => null);
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setLoading(false);
    };
    load();
  }, [refreshTick]);

  useEffect(() => {
    const text = appliedFilters.searchText.toLowerCase().trim();
    const { from, to } = buildRange(appliedFilters);
    const slotDuration = appliedFilters.slotDuration;
    const customDuration = Number(appliedFilters.customDuration);

    const next = events.filter((event) => {
      const startValue = event.start;
      const startDate = toDateOrNull(startValue);
      const endDate = toDateOrNull(event.end) || startDate;
      const meta = extractPatientAndTreatment(event);
      const durationMinutes = minutesBetween(startDate, endDate);

      if (text) {
        const haystack = `${meta.patientName} ${meta.treatmentType} ${event.summary} ${event.description} ${event.location}`
          .toLowerCase()
          .trim();
        if (!haystack.includes(text)) return false;
      }

      if (from && endDate && endDate < from) return false;
      if (to && startDate && startDate > to) return false;
      if ((from || to) && !startDate) return false;

      if (slotDuration !== 'all') {
        const expected = slotDuration === 'custom' ? customDuration : Number(slotDuration);
        if (!durationMinutes || Number.isNaN(expected)) return false;
        if (durationMinutes !== expected) return false;
      }

      return true;
    });

    next.sort((a, b) => {
      const aStart = toDateOrNull(a.start)?.getTime() ?? 0;
      const bStart = toDateOrNull(b.start)?.getTime() ?? 0;
      const aTitle = (a.summary || '').toLowerCase();
      const bTitle = (b.summary || '').toLowerCase();

      if (appliedFilters.sortBy === 'startDesc') return bStart - aStart;
      if (appliedFilters.sortBy === 'durationAsc') {
        const aDur = minutesBetween(toDateOrNull(a.start), toDateOrNull(a.end)) ?? 0;
        const bDur = minutesBetween(toDateOrNull(b.start), toDateOrNull(b.end)) ?? 0;
        return aDur - bDur;
      }
      if (appliedFilters.sortBy === 'durationDesc') {
        const aDur = minutesBetween(toDateOrNull(a.start), toDateOrNull(a.end)) ?? 0;
        const bDur = minutesBetween(toDateOrNull(b.start), toDateOrNull(b.end)) ?? 0;
        return bDur - aDur;
      }
      if (aTitle < bTitle) return -1;
      if (aTitle > bTitle) return 1;
      return aStart - bStart;
    });

    setFiltered(next);
  }, [events, appliedFilters]);

  useEffect(() => {
    const { error } = buildRange(filters);
    if (error) {
      setFilterError(error);
      return;
    }
    if (filters.slotDuration === 'custom') {
      const customValue = Number(filters.customDuration);
      if (!customValue || customValue <= 0) {
        setFilterError('Custom duration must be a positive number of minutes.');
        return;
      }
    }
    setFilterError('');
  }, [filters]);

  const applyFilters = async () => {
    const { from, error } = buildRange(filters);
    if (error) {
      setFilterError(error);
      return;
    }
    setFilterError('');
    setAppliedFilters(filters);

    const timeMin = from ? from.toISOString() : null;
    const rangeKey = JSON.stringify({
      from: filters.fromDate,
      to: filters.toDate,
      fromTime: filters.fromTime,
      toTime: filters.toTime,
    });

    if (rangeKey !== lastFetchKey) {
      setLastFetchKey(rangeKey);
      const params = new URLSearchParams({ maxResults: '100' });
      if (timeMin) params.set('timeMin', timeMin);
      setLoading(true);
      const resp = await fetch(`/api/events?${params.toString()}`);
      const data = await resp.json().catch(() => null);
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setLoading(false);
    }
  };

  const resetFilters = async () => {
    const next = {
      searchText: '',
      slotDuration: 'all',
      customDuration: '45',
      fromDate: '',
      toDate: '',
      fromTime: '00:00',
      toTime: '00:00',
      sortBy: 'startAsc',
    };
    setFilters(next);
    setAppliedFilters(next);
    setFilterError('');
    setLastFetchKey('');
    setSearchQuery('');

    setLoading(true);
    const resp = await fetch('/api/events?maxResults=100');
    const data = await resp.json().catch(() => null);
    setEvents(Array.isArray(data?.events) ? data.events : []);
    setLoading(false);
  };

  const empty = !loading && filtered.length === 0;

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h3>Search</h3>
          <p>Find events quickly across your calendar data.</p>
        </div>
        <Button variant="ghost" onClick={resetFilters}>Reset Filters</Button>
      </div>

      <Card className="filter-panel">
        <div className="filter-header">
          <h4>Filters</h4>
          <Button variant="ghost" onClick={() => setFilterOpen((v) => !v)}>
            {filterOpen ? 'Hide' : 'Show'}
          </Button>
        </div>
        {filterOpen && (
          <div className="filter-content">
            <div className="filter-grid">
              <label className="filter-field">
                Search
                <div className="input-with-icon">
                  <span className="input-icon" aria-hidden="true">?</span>
                  <input
                    className="input"
                    value={filters.searchText}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFilters((f) => ({ ...f, searchText: value }));
                      setSearchQuery(value);
                    }}
                    placeholder="Search by patient name or treatment type"
                    aria-label="Search by patient name or treatment type"
                  />
                </div>
              </label>
              <label className="filter-field">
                Slot Duration
                <select
                  className="input"
                  value={filters.slotDuration}
                  onChange={(e) => setFilters((f) => ({ ...f, slotDuration: e.target.value }))}
                  aria-label="Slot duration"
                >
                  <option value="all">All Slots</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {filters.slotDuration === 'custom' && (
                <label className="filter-field">
                  Custom Minutes
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={filters.customDuration}
                    onChange={(e) => setFilters((f) => ({ ...f, customDuration: e.target.value }))}
                    aria-label="Custom slot duration in minutes"
                  />
                </label>
              )}
              <label className="filter-field">
                From Date
                <input
                  className="input"
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFilters((f) => ({
                      ...f,
                      fromDate: value,
                      toDate: f.toDate && value && f.toDate < value ? '' : f.toDate,
                    }));
                  }}
                  aria-label="From date"
                />
              </label>
              <label className="filter-field">
                To Date
                <input
                  className="input"
                  type="date"
                  value={filters.toDate}
                  min={filters.fromDate || undefined}
                  onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
                  aria-label="To date"
                />
              </label>
              <label className="filter-field">
                From Time
                <input
                  className="input"
                  type="time"
                  value={filters.fromTime}
                  max={filters.fromDate && filters.toDate && filters.fromDate === filters.toDate && filters.toTime !== '00:00' ? filters.toTime : undefined}
                  onChange={(e) => setFilters((f) => ({ ...f, fromTime: e.target.value }))}
                  aria-label="From time"
                />
              </label>
              <label className="filter-field">
                To Time
                <input
                  className="input"
                  type="time"
                  value={filters.toTime}
                  min={filters.fromDate && filters.toDate && filters.fromDate === filters.toDate && filters.toTime !== '00:00' ? filters.fromTime : undefined}
                  onChange={(e) => setFilters((f) => ({ ...f, toTime: e.target.value }))}
                  aria-label="To time"
                />
              </label>
              <label className="filter-field">
                Sort by
                <select
                  className="input"
                  value={filters.sortBy}
                  onChange={(e) => setFilters((f) => ({ ...f, sortBy: e.target.value }))}
                  aria-label="Sort by"
                >
                  <option value="startAsc">Start time (earliest first)</option>
                  <option value="startDesc">Start time (latest first)</option>
                  <option value="durationAsc">Slot time (shortest)</option>
                  <option value="durationDesc">Slot time (longest)</option>
                </select>
              </label>
            </div>
            {filterError && <p className="filter-error" role="alert">{filterError}</p>}
            <div className="filter-actions">
              <Button variant="ghost" onClick={resetFilters}>
                Reset Filters
              </Button>
              <Button variant="primary" onClick={applyFilters} disabled={Boolean(filterError)}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}
      </Card>

      {loading ? (
        <div className="skeleton-grid">
          <div className="skeleton-card"></div>
          <div className="skeleton-card"></div>
          <div className="skeleton-card"></div>
        </div>
      ) : (
        <div className="events">
          {filtered.map((event) => (
            <Card className="event-card" key={event.id}>
              <div className="event-title">
                <h4 className="truncate" title={event.summary || ''}>
                  {event.summary || '(No title)'}
                </h4>
                <span className="muted truncate">{formatDate(event.start)}</span>
              </div>
              <p className="muted truncate">{event.location || 'No location'}</p>
              <p className="muted break">{event.description || 'No description provided.'}</p>
              <div className="event-actions">
                <a className="btn ghost" href={event.htmlLink} target="_blank" rel="noreferrer">
                  View
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}

      {empty && (
        <Card className="empty">
          <div className="empty-illus">?</div>
          <h4>No events found</h4>
          <p className="muted">Adjust filters or refresh to see more events.</p>
          <Button variant="primary" onClick={resetFilters}>
            Reset Filters
          </Button>
        </Card>
      )}
    </div>
  );
}
