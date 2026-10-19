import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { SESSION_ENDED_MESSAGE, onUnauthorized } from '../api/client';

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  // One session notice stands in for every request that 401s at the same moment.
  const lastExpiryNotice = useRef(0);

  const toast = useCallback((message, type = 'info', title = '') => {
    if (message === SESSION_ENDED_MESSAGE && Date.now() - lastExpiryNotice.current < 8000) {
      return null;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    setToasts((current) => [...current.slice(-3), { id, message, type, title }]);
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4500);
    return id;
  }, [dismiss]);

  useEffect(() => onUnauthorized(() => {
    const now = Date.now();
    if (now - lastExpiryNotice.current < 8000) return;
    lastExpiryNotice.current = now;
    toast('Your session ended. Sign in again to keep going.', 'error', 'Signed out');
  }), [toast]);

  const value = useMemo(() => ({ toast, dismiss, toasts }), [toast, dismiss, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <Icon size={18} className="toast__icon" />
              <div className="flex-1">
                {t.title && <strong>{t.title}</strong>}
                <span>{t.message}</span>
              </div>
              <button
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
