import { Link } from 'react-router-dom';
import { CalendarX2, Compass, Home as HomeIcon, Plus } from 'lucide-react';

import { useDocumentTitle } from '../hooks';

export default function NotFound() {
  useDocumentTitle('Page not found');

  return (
    <div className="page">
      <div className="container">
        <div className="empty" style={{ paddingTop: 'var(--s-10)' }}>
          <span className="empty__icon"><CalendarX2 size={24} /></span>
          <h1 className="empty__title" style={{ fontSize: 'var(--fs-2xl)' }}>This page has moved on</h1>
          <p className="empty__text">
            The link may be out of date, or the event it pointed to was removed. Here are a few
            better places to be.
          </p>
          <div className="empty__actions row row--tight">
            <Link to="/" className="btn btn--secondary"><HomeIcon size={16} /> Home</Link>
            <Link to="/discover" className="btn btn--primary"><Compass size={16} /> Discover events</Link>
            <Link to="/events/new" className="btn btn--ghost"><Plus size={16} /> Create an event</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
