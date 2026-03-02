import React, { useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AuthContext, ThemeContext, UiContext } from '../App.jsx';
import Button from './ui/Button.jsx';

const placeholderAvatar =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="%233b82f6"/><stop offset="1" stop-color="%2322d3ee"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(%23g)"/><text x="50%" y="54%" text-anchor="middle" font-size="24" font-family="Inter,Arial" fill="white">GC</text></svg>';

export default function Layout() {
  const navigate = useNavigate();
  const { localAuth, loading, setLocalAuth } = useContext(AuthContext);
  const { theme, toggle } = useContext(ThemeContext);
  const { searchQuery, setSearchQuery, requestRefresh } = useContext(UiContext);
  const [profile, setProfile] = useState({ name: 'User', email: '', picture: '' });

  useEffect(() => {
    if (!localAuth) return;
    const loadProfile = async () => {
      const resp = await fetch('/api/me');
      const data = await resp.json().catch(() => null);
      if (data?.authenticated) {
        setProfile({
          name: data.user?.name || 'User',
          email: data.user?.email || '',
          picture: data.user?.picture || '',
        });
      } else {
        setProfile({ name: 'Connect Google', email: '', picture: '' });
      }
    };
    loadProfile();
  }, [localAuth]);

  const onLogout = async () => {
    await fetch('/api/local/logout', { method: 'POST' });
    setLocalAuth(false);
    navigate('/login', { replace: true });
  };

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  const navClass = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">GC</div>
          <div>
            <h1>Calendar</h1>
            <p>Premium Workspace</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink className={navClass} to="/dashboard">
            <span className="nav-icon">▣</span>
            Dashboard
          </NavLink>
          <NavLink className={navClass} to="/search">
            <span className="nav-icon">⌕</span>
            Search
          </NavLink>
          <NavLink className={navClass} to="/events">
            <span className="nav-icon">◷</span>
            Events
          </NavLink>
          <NavLink className={navClass} to="/settings">
            <span className="nav-icon">⚙</span>
            Settings
          </NavLink>
          <button className="nav-item danger" type="button" onClick={onLogout}>
            <span className="nav-icon">⟲</span>
            Logout
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="profile-mini">
            <img src={profile.picture || placeholderAvatar} alt="Profile" />
            <div className="truncate">
              <p className="truncate">{profile.name}</p>
              <span className="muted truncate">{profile.email || 'Not connected'}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <h2>Workspace</h2>
            <p>Stay on top of your calendar operations.</p>
          </div>
          <div className="topbar-center">
            <label className="search-pill">
              <span>⌕</span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                type="text"
                placeholder="Search events, organizers, locations"
              />
            </label>
          </div>
          <div className="topbar-actions">
            <Button variant="ghost" onClick={requestRefresh}>
              Refresh
            </Button>
            <label className="toggle">
              <input type="checkbox" checked={theme === 'dark'} onChange={toggle} />
              <span className="toggle-track"></span>
              <span className="toggle-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </label>
            <div className="avatar-pill">
              <img src={profile.picture || placeholderAvatar} alt="Profile" />
            </div>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
