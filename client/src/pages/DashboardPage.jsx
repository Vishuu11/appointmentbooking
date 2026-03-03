import React, { useContext, useEffect, useState } from 'react';
import { UiContext } from '../App.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import { formatDisplayDate } from '../utils/dateFormat.js';

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAllDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateParts(value) {
  if (!value) return { date: '', time: '00:00', allDay: false };
  if (isAllDay(value)) return { date: value, time: '00:00', allDay: true };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '00:00', allDay: false };
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    allDay: false,
  };
}

function formatRange(start, end) {
  if (!start && !end) return '';
  const allDay = isAllDay(start) && isAllDay(end);
  const startLabel = formatDisplayDate(start, { includeTime: !allDay, fallback: '' });
  const endLabel = formatDisplayDate(end || start, { includeTime: !allDay, fallback: '' });
  if (!startLabel) return '';
  if (!endLabel || endLabel === startLabel) return startLabel;
  return `${startLabel} - ${endLabel}`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  if (isAllDay(value)) return formatDisplayDate(value, { includeTime: false, fallback: 'N/A' });
  return formatDisplayDate(value, { fallback: 'N/A' });
}

function formatTime(value) {
  if (!value) return 'N/A';
  if (isAllDay(value)) return 'All day';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getStatus(event) {
  const now = Date.now();
  const start = toDateOrNull(event.start)?.getTime();
  const end = toDateOrNull(event.end)?.getTime();
  if (!start || !end) return 'upcoming';
  if (now >= start && now <= end) return 'ongoing';
  if (now > end) return 'completed';
  return 'upcoming';
}

function animateCount(setter, value) {
  const duration = 700;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const current = Math.floor(value * progress);
    setter(current);
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

export default function DashboardPage() {
  const { refreshTick } = useContext(UiContext);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [googleAuth, setGoogleAuth] = useState({ authenticated: false, user: null });
  const [stats, setStats] = useState({ total: 0, today: 0, week: 0 });
  const [timeline, setTimeline] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [editValues, setEditValues] = useState({
    summary: '',
    description: '',
    startDate: '',
    startTime: '00:00',
    endDate: '',
    endTime: '00:00',
  });
  const [editError, setEditError] = useState('');

  useEffect(() => {
    const loadAuth = async () => {
      const resp = await fetch('/api/me');
      const data = await resp.json().catch(() => null);
      setGoogleAuth({ authenticated: Boolean(data?.authenticated), user: data?.user || null });
    };
    loadAuth();
  }, []);

  const loadEvents = async (timeMin) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ maxResults: '100' });
      if (timeMin) params.set('timeMin', timeMin);
      const resp = await fetch(`/api/events?${params.toString()}`);
      if (!resp.ok) {
        setEvents([]);
        return;
      }
      const data = await resp.json();
      const list = Array.isArray(data.events) ? data.events : [];
      setEvents(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [refreshTick]);

  useEffect(() => {
    const next = events;
    const todayStr = new Date().toISOString().slice(0, 10);
    const total = next.length;
    const today = next.filter((e) => String(e.start || '').startsWith(todayStr)).length;
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const week = next.filter((e) => {
      const start = toDateOrNull(e.start);
      return start && start <= weekEnd;
    }).length;

    animateCount((v) => setStats((s) => ({ ...s, total: v })), total);
    animateCount((v) => setStats((s) => ({ ...s, today: v })), today);
    animateCount((v) => setStats((s) => ({ ...s, week: v })), week);
  }, [events]);

  const handleGoogleConnect = () => {
    window.location.href = '/auth/google';
  };

  const handleGoogleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setGoogleAuth({ authenticated: false, user: null });
  };

  const startEdit = (event) => {
    const start = toDateParts(event.start);
    const end = toDateParts(event.end || event.start);
    setEditEvent(event);
    setEditValues({
      summary: event.summary || '',
      description: event.description || '',
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
    });
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editEvent) return;
    const startDate = editValues.startDate;
    const endDate = editValues.endDate;
    const startTime = editValues.startTime || '00:00';
    const endTime = editValues.endTime || '00:00';

    if (!startDate || !endDate) {
      setEditError('Start and end date are required.');
      return;
    }

    const startDateTime = `${startDate}T${startTime}:00`;
    const endDateTime = `${endDate}T${endTime}:00`;
    const startObj = new Date(startDateTime);
    const endObj = new Date(endDateTime);

    if (Number.isNaN(startObj.getTime()) || Number.isNaN(endObj.getTime())) {
      setEditError('Please provide valid start and end date/time.');
      return;
    }
    if (endObj <= startObj) {
      setEditError('End date/time must be after start date/time.');
      return;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await fetch(`/api/events/${encodeURIComponent(editEvent.id)}?sendUpdates=all`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: editValues.summary,
        description: editValues.description,
        start: { dateTime: startDateTime, timeZone },
        end: { dateTime: endDateTime, timeZone },
      }),
    });
    setEditEvent(null);
    await loadEvents();
  };

  const deleteEvent = async (eventId) => {
    if (!window.confirm('Delete this event? This will notify attendees.')) return;
    await fetch(`/api/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: 'DELETE',
    });
    await loadEvents();
  };

  const empty = !loading && events.length === 0;

  return (
    <div className="page">
      <section className="stats">
        <Card className="stat-card">
          <div className="stat-icon">?</div>
          <div>
            <p>Total Events</p>
            <h3>{stats.total}</h3>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="stat-icon">?</div>
          <div>
            <p>Today's Events</p>
            <h3>{stats.today}</h3>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="stat-icon">?</div>
          <div>
            <p>Upcoming This Week</p>
            <h3>{stats.week}</h3>
          </div>
        </Card>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h3>Events</h3>
            <p>Keep tabs on every meeting and milestone.</p>
          </div>
          <div className="section-actions">
            {!googleAuth.authenticated ? (
              <Button variant="primary" onClick={handleGoogleConnect}>Connect Google</Button>
            ) : (
              <Button variant="ghost" onClick={handleGoogleLogout}>Google Logout</Button>
            )}
            <div className="view-toggle">
              <span>List</span>
              <label className="switch">
                <input type="checkbox" checked={timeline} onChange={() => setTimeline((v) => !v)} />
                <span className="slider"></span>
              </label>
              <span>Timeline</span>
            </div>
          </div>
        </div>

        {loading && (
          <div className="skeleton-grid">
            <div className="skeleton-card"></div>
            <div className="skeleton-card"></div>
            <div className="skeleton-card"></div>
            <div className="skeleton-card"></div>
          </div>
        )}

        {!loading && (
          <div className={`events ${timeline ? 'timeline' : ''}`}>
            {events.map((event) => {
              const status = getStatus(event);
              const rangeLabel = formatRange(event.start, event.end);
              return (
                <Card key={event.id} className={`event-card ${timeline ? 'timeline-item' : ''}`}>
                  {timeline && <span className="timeline-marker"></span>}
                  <div className="event-title">
                    <h4 className="truncate" title={event.summary || ''}>
                      {(event.summary || '(No title)')}{rangeLabel ? ` (${rangeLabel})` : ''}
                    </h4>
                    <Badge variant={status}>{status}</Badge>
                  </div>
                  <div className="event-meta">
                    <span className="truncate">📅 {formatDate(event.start)}</span>
                    <span className="truncate">🕒 {formatTime(event.start)}</span>
                    <span className="truncate">✉️ {event.organizer || 'Unknown'}</span>
                  </div>
                  <div className="event-divider"></div>
                  <p className="muted break">{event.description || 'No description provided.'}</p>
                  <div className="event-actions">
                    <a className="btn ghost" href={event.htmlLink} target="_blank" rel="noreferrer">
                      View
                    </a>
                    <Button variant="outline" onClick={() => startEdit(event)}>
                      Modify
                    </Button>
                    <Button variant="danger" onClick={() => deleteEvent(event.id)}>
                      Delete
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {empty && (
          <Card className="empty">
            <div className="empty-illus">?</div>
            <h4>No events yet</h4>
            <p className="muted">Connect your calendar or refresh to pull fresh events.</p>
            <Button variant="primary" onClick={loadEvents}>
              Refresh
            </Button>
          </Card>
        )}
      </section>

      {editEvent && (
        <div className="modal-backdrop" onClick={() => setEditEvent(null)}>
          <Card className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Modify Event</h3>
            <label className="field">
              Title
              <input
                className="input"
                value={editValues.summary}
                onChange={(e) => setEditValues((v) => ({ ...v, summary: e.target.value }))}
              />
            </label>
            <label className="field">
              Description
              <textarea
                className="input"
                rows="4"
                value={editValues.description}
                onChange={(e) => setEditValues((v) => ({ ...v, description: e.target.value }))}
              />
            </label>
            <label className="field">
              Start Date
              <input
                className="input"
                type="date"
                value={editValues.startDate}
                onChange={(e) => setEditValues((v) => ({ ...v, startDate: e.target.value }))}
              />
            </label>
            <label className="field">
              Start Time
              <input
                className="input"
                type="time"
                value={editValues.startTime}
                onChange={(e) => setEditValues((v) => ({ ...v, startTime: e.target.value }))}
              />
            </label>
            <label className="field">
              End Date
              <input
                className="input"
                type="date"
                value={editValues.endDate}
                onChange={(e) => setEditValues((v) => ({ ...v, endDate: e.target.value }))}
              />
            </label>
            <label className="field">
              End Time
              <input
                className="input"
                type="time"
                value={editValues.endTime}
                onChange={(e) => setEditValues((v) => ({ ...v, endTime: e.target.value }))}
              />
            </label>
            {editError && <p className="filter-error" role="alert">{editError}</p>}
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setEditEvent(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveEdit}>
                Save
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
