import React, { useEffect, useState } from 'react';
import Card from '../components/ui/Card.jsx';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatAllDay(value) {
  const parts = String(value).split('-');
  if (parts.length !== 3) return String(value);
  const [year, month, day] = parts;
  if (!year || !month || !day) return String(value);
  return `${pad(day)}/${pad(month)}/${year}`;
}

function formatDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatAllDay(value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const hasTime = hours !== '00' || minutes !== '00' || String(value).includes('T');

  return hasTime ? `${day}/${month}/${year} ${hours}:${minutes}` : `${day}/${month}/${year}`;
}


export default function EventsPage() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const load = async () => {
      const resp = await fetch('/api/events?maxResults=100');
      const data = await resp.json().catch(() => null);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    };
    load();
  }, []);

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h3>Events Library</h3>
          <p>All upcoming calendar events in one place.</p>
        </div>
      </div>

      <div className="events">
        {events.map((event) => (
          <Card className="event-card" key={event.id}>
            <div className="event-title">
              <h4 className="truncate">{event.summary || '(No title)'}</h4>
              <span className="muted truncate">{formatDate(event.start)}</span>
            </div>
            <p className="muted break">{event.description || 'No description provided.'}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
