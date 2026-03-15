import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SetupWizard from './SetupWizard';
import './index.css';

function Root() {
  const [ready, setReady] = useState(null); // null = checking, true = ready, false = needs setup

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => setReady(data.claude?.available === true))
      .catch(() => setReady(false));
  }, []);

  // Still checking
  if (ready === null) return null;

  // Claude CLI not found — show wizard
  if (!ready) {
    return <SetupWizard onComplete={() => setReady(true)} />;
  }

  // Good to go
  return <App />;
}

createRoot(document.getElementById('root')).render(<Root />);
