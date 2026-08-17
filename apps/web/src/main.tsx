import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyStoredTheme } from './lib/theme';
import './styles.css';

// Apply a previously persisted explicit theme choice, if any, before the
// first paint. No-op for every visitor today (no UI exposes the toggle
// yet — M1/M2 wires one against ./lib/theme) — see that module's contract
// for why this never stamps a default.
applyStoredTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element "#root" not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
