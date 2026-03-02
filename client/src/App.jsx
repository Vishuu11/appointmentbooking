import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export const ThemeContext = React.createContext(null);
export const AuthContext = React.createContext(null);
export const UiContext = React.createContext(null);

function AppRoutes() {
  const navigate = useNavigate();
  const { localAuth, loading } = React.useContext(AuthContext);

  useEffect(() => {
    if (!loading && !localAuth && window.location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [loading, localAuth, navigate]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  const [theme, setTheme] = useState('light');
  const [localAuth, setLocalAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    const loadAuth = async () => {
      try {
        const resp = await fetch('/api/local/me');
        const data = await resp.json();
        if (mounted) {
          setLocalAuth(Boolean(data?.authenticated));
        }
      } catch {
        if (mounted) setLocalAuth(false);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadAuth();
    return () => {
      mounted = false;
    };
  }, []);

  const themeValue = useMemo(() => ({
    theme,
    setTheme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  }), [theme]);

  const authValue = useMemo(() => ({
    localAuth,
    setLocalAuth,
    loading,
  }), [localAuth, loading]);

  const uiValue = useMemo(() => ({
    searchQuery,
    setSearchQuery,
    refreshTick,
    requestRefresh: () => setRefreshTick((x) => x + 1),
  }), [searchQuery, refreshTick]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <AuthContext.Provider value={authValue}>
        <UiContext.Provider value={uiValue}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </UiContext.Provider>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}
