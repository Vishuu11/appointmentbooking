import React, { useContext } from 'react';
import { ThemeContext } from '../App.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';

export default function SettingsPage() {
  const { theme, toggle } = useContext(ThemeContext);

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h3>Settings</h3>
          <p>Personalize your workspace experience.</p>
        </div>
      </div>

      <Card className="card">
        <div className="settings-row">
          <div>
            <h4>Theme</h4>
            <p className="muted">Switch between light and dark appearances.</p>
          </div>
          <Button variant="ghost" onClick={toggle}>
            {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
