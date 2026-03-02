import React, { useEffect, useState } from 'react';
import Card from '../components/ui/Card.jsx';

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
              <span className="muted truncate">{event.start || ''}</span>
            </div>
            <p className="muted break">{event.description || 'No description provided.'}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
