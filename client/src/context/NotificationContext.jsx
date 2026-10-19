import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken } from '../api/client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const NotificationContext = createContext({
  notifications: [],
  unread: 0,
  refresh: () => {},
  markRead: () => {},
});

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [socket, setSocket] = useState(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setNotifications([]);
      setUnread(0);
      return;
    }
    try {
      const data = await api.get('/notifications?limit=40');
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
    } catch {
      /* silent — the bell just stays as it was */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, user?.id]);

  // Realtime pushes: notifications land in the personal socket room.
  useEffect(() => {
    const token = getToken();
    if (!token || !user) {
      setSocket(null);
      return undefined;
    }

    const connection = io({ auth: { token }, transports: ['websocket', 'polling'] });

    connection.on('notification:new', (notification) => {
      setNotifications((current) => [notification, ...current].slice(0, 40));
      setUnread((n) => n + 1);
      toast(notification.body || notification.title, 'info', notification.title);
    });

    setSocket(connection);
    return () => {
      connection.removeAllListeners();
      connection.disconnect();
    };
  }, [user?.id, toast]);

  const markRead = useCallback(async (id = null) => {
    if (!getToken()) return;

    setNotifications((current) =>
      id
        ? current.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        : current.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
    );
    setUnread((current) => (id ? Math.max(0, current - 1) : 0));

    try {
      await api.post('/notifications/read', id ? { id } : {});
    } catch {
      refresh();
    }
  }, [refresh]);

  const value = useMemo(
    () => ({ notifications, unread, refresh, markRead, socket }),
    [notifications, unread, refresh, markRead, socket]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useNotifications = () => useContext(NotificationContext);
