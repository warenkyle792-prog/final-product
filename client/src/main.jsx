import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

import './styles/theme.css';
import './styles/app.css';

/**
 * A tab left open across a deploy holds the previous asset hashes, so a lazy
 * route can 404 and leave the Suspense fallback spinning. Reload once to pick
 * up the current build instead of hanging.
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'eventtracker_reloaded_for_deploy';
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <NotificationProvider>
              <App />
            </NotificationProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
