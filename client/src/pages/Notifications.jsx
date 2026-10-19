import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, Bookmark, CalendarCheck, CheckCheck, MessageCircle, Megaphone, Star, Ticket, Wallet,
} from 'lucide-react';

import { EmptyState, TabBar } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useDocumentTitle } from '../hooks';
import { timeAgo } from '../utils/format';

const ICONS = {
  ticket: Ticket,
  payment: Wallet,
  promotion: Megaphone,
  follow: Star,
  comment: MessageCircle,
  event: CalendarCheck,
  rsvp: CalendarCheck,
  system: Bell,
};

export default function Notifications() {
  useDocumentTitle('Notifications');

  const { user } = useAuth();
  const { notifications, unread, markRead, refresh } = useNotifications();

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<Bell size={22} />}
            title="Sign in to see notifications"
            text="Ticket confirmations, payment receipts and event updates land here."
            action={<Link to="/login" className="btn btn--primary">Sign in</Link>}
          />
        </div>
      </div>
    );
  }

  const unreadList = notifications.filter((item) => !item.read_at);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 800 }}>
        <div className="page-head">
          <div>
            <h1>Notifications</h1>
            <p>Ticket confirmations, payment updates, promotion reports and activity on your events.</p>
          </div>
          <div className="row row--tight">
            <button className="btn btn--secondary btn--sm" onClick={refresh}>Refresh</button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => markRead()}
              disabled={unread === 0}
            >
              <CheckCheck size={15} /> Mark all read
            </button>
          </div>
        </div>

        <UnreadTabs unreadList={unreadList} notifications={notifications} markRead={markRead} />
      </div>
    </div>
  );
}

function UnreadTabs({ unreadList, notifications, markRead }) {
  const [tab, setTab] = useState('all');
  const list = tab === 'unread' ? unreadList : notifications;

  return (
    <>
      <TabBar
        tabs={[
          { id: 'all', label: 'All', count: notifications.length },
          { id: 'unread', label: 'Unread', count: unreadList.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={22} />}
          title={tab === 'unread' ? 'Nothing unread' : 'No notifications yet'}
          text="Follow a few events or buy a ticket and updates will start arriving here."
          action={<Link to="/discover" className="btn btn--primary">Find events</Link>}
        />
      ) : (
        <div className="panel panel--pad-sm">
          {list.map((notification) => {
            const Icon = ICONS[notification.type] || Bell;
            const content = (
              <>
                <span className="notif__icon"><Icon size={17} /></span>
                <span className="notif__body">
                  <span className="notif__title">{notification.title}</span>
                  {notification.body && <span className="notif__text">{notification.body}</span>}
                  <span className="notif__time">{timeAgo(notification.created_at)}</span>
                </span>
                {!notification.read_at && <span className="notif__dot" aria-label="Unread" />}
              </>
            );

            return notification.link ? (
              <Link
                key={notification.id}
                to={notification.link}
                className={`notif ${notification.read_at ? '' : 'is-unread'}`}
                onClick={() => !notification.read_at && markRead(notification.id)}
              >
                {content}
              </Link>
            ) : (
              <button
                key={notification.id}
                className={`notif w-full ${notification.read_at ? '' : 'is-unread'}`}
                style={{ textAlign: 'left' }}
                onClick={() => !notification.read_at && markRead(notification.id)}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
