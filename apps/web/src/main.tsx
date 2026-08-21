import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/theme';
import './styles.css';

// Stamp the stored theme preference on <html> before the first render —
// dark is the stylesheet default, so only an explicit stored choice
// changes anything (Theme Spec v2; lib/theme.ts).
initTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element "#root" not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
