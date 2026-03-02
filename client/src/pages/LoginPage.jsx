import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext, ThemeContext } from '../App.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';

export default function LoginPage() {
  const navigate = useNavigate();
  const { localAuth, setLocalAuth } = useContext(AuthContext);
  const { setTheme } = useContext(ThemeContext);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setTheme('light');
    if (localAuth) {
      navigate('/dashboard', { replace: true });
    }
  }, [localAuth, navigate, setTheme]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Signing in...');
    const resp = await fetch('/api/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!resp.ok) {
      const msg = (await resp.json().catch(() => null))?.message || 'Login failed.';
      setStatus(msg);
      return;
    }

    setLocalAuth(true);
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="login-shell">
      <Card className="login-card">
        <div className="login-header">
          <div>
            <h1>Sign In</h1>
          </div>
        </div>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            Username
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <Button type="submit" variant="primary">Sign In</Button>
        </form>
        <p className="muted small">{status}</p>
      </Card>
    </div>
  );
}
