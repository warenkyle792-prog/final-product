import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, RefreshCw, Ticket as TicketIcon } from 'lucide-react';

import TicketCard from '../components/TicketCard';
import { EmptyState, LoadingBlock, TabBar } from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useDocumentTitle } from '../hooks';

export default function Tickets() {
  useDocumentTitle('My tickets');

  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState('upcoming');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await api.get('/tickets'));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const upcoming = data?.upcoming || [];
  const past = data?.past || [];
  const list = tab === 'upcoming' ? upcoming : past;

  if (authLoading) {
    return <div className="page"><div className="container"><LoadingBlock label="Loading…" /></div></div>;
  }

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<TicketIcon size={22} />}
            title="Sign in to see your tickets"
            text="Every ticket you buy or register for is kept here, with its QR code."
            action={<Link to="/login" className="btn btn--primary">Sign in</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>My tickets</h1>
            <p>Tickets are issued only after the payment is confirmed, and each QR code is valid for one entry.</p>
          </div>
          <div className="row row--tight">
            <button className="btn btn--secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <Link to="/verify" className="btn btn--secondary">
              <QrCode size={16} /> Verify a ticket
            </Link>
          </div>
        </div>

        <TabBar
          tabs={[
            { id: 'upcoming', label: 'Upcoming', count: upcoming.length },
            { id: 'past', label: 'Past', count: past.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {loading && <LoadingBlock label="Loading your tickets…" />}

        {!loading && error && (
          <EmptyState icon={<TicketIcon size={22} />} title="Could not load tickets" text={error.message} />
        )}

        {!loading && !error && list.length === 0 && (
          <EmptyState
            icon={<TicketIcon size={22} />}
            title={tab === 'upcoming' ? 'No upcoming tickets' : 'No past tickets'}
            text={tab === 'upcoming'
              ? 'Register for a free event or buy a ticket and it will appear here straight away.'
              : 'Tickets for events that have already happened are kept here for your records.'}
            action={<Link to="/discover" className="btn btn--primary">Find something to attend</Link>}
          />
        )}

        {!loading && list.length > 0 && (
          <div className="stack stack--lg">
            {list.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}
          </div>
        )}
      </div>
    </div>
  );
}
