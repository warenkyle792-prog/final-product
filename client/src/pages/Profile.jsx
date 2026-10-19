import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck, Bookmark, CalendarDays, ExternalLink, Heart, LogOut, Mail, MapPin,
  Pencil, Plus, Settings, ShieldCheck, Ticket, UserMinus, UserPlus, Users,
} from 'lucide-react';

import EventCard from '../components/EventCard';
import MediaUploader from '../components/MediaUploader';
import {
  Avatar, CardSkeletonGrid, EmptyState, LoadingBlock, Modal, SectionHead, StatCell, TabBar,
} from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync, useDocumentTitle } from '../hooks';
import { timeAgo } from '../utils/format';

const TABS = [
  { id: 'hosting', label: 'Hosting', icon: <CalendarDays size={15} /> },
  { id: 'attending', label: 'Attending', icon: <Ticket size={15} /> },
  { id: 'saved', label: 'Saved', icon: <Bookmark size={15} />, ownOnly: true },
  { id: 'following', label: 'Following', icon: <Heart size={15} />, ownOnly: true },
];

export default function Profile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user: me, patchUser } = useAuth();
  const { toast } = useToast();

  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'hosting');
  const [editOpen, setEditOpen] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const isOwnProfile = !username || username === me?.username;
  const key = isOwnProfile ? me?.username : username;

  const { data: profileData, loading: profileLoading, reload: reloadProfile } = useAsync(
    () => (key ? api.get(`/users/${key}`) : Promise.resolve(null)),
    [key]
  );

  const { data: eventData, loading: eventsLoading, reload: reloadEvents } = useAsync(
    () => (key ? api.get(`/users/${key}/events?tab=${tab}`) : Promise.resolve(null)),
    [key, tab, me?.id]
  );

  const profile = profileData?.user;
  useDocumentTitle(profile ? `${profile.name} (@${profile.username})` : 'Profile');

  const visibleTabs = TABS.filter((item) => !item.ownOnly || profile?.is_me);

  const changeTab = (next) => {
    setTab(next);
    setParams(next === 'hosting' ? {} : { tab: next }, { replace: true });
  };

  useEffect(() => {
    if (profile && !visibleTabs.some((item) => item.id === tab)) changeTab('hosting');
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFollow = async () => {
    if (!me) {
      navigate('/login');
      return;
    }
    setFollowBusy(true);
    try {
      const result = await api.post(`/users/${profile.username}/follow`);
      toast(result.is_following ? `Following ${profile.name}` : `Unfollowed ${profile.name}`, 'success');
      reloadProfile();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setFollowBusy(false);
    }
  };

  if (!me && isOwnProfile) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<Users size={22} />}
            title="Sign in to open your profile"
            action={<Link to="/login" className="btn btn--primary">Sign in</Link>}
          />
        </div>
      </div>
    );
  }

  if (profileLoading && !profile) {
    return <div className="page"><div className="container"><LoadingBlock label="Loading profile…" /></div></div>;
  }

  if (!profile) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<Users size={22} />}
            title="Profile not found"
            text={`No account matches “${username}”.`}
            action={<Link to="/discover" className="btn btn--primary">Browse events</Link>}
          />
        </div>
      </div>
    );
  }

  const stats = profile.stats || {};
  const events = eventData?.events || [];

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="profile-hero">
          {profile.cover_url ? (
            <div className="profile-hero__cover" style={{ backgroundImage: `url(${profile.cover_url})` }} />
          ) : (
            <div className="profile-hero__cover profile-hero__cover--fallback" />
          )}

          <div className="profile-hero__body">
            <span className="profile-hero__avatar-wrap">
              <Avatar user={profile} size="xl" />
            </span>

            <div className="profile-hero__id">
              <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h1 className="profile-hero__name" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {profile.name}
                    {profile.role && profile.role !== 'user' && (
                      <span className="badge badge--brand"><BadgeCheck size={13} /> {profile.role}</span>
                    )}
                  </h1>
                  <div className="profile-hero__handle">@{profile.username}</div>
                </div>

                <div className="row row--tight">
                  {profile.is_me ? (
                    <>
                      <button className="btn btn--secondary btn--sm" onClick={() => setEditOpen(true)}>
                        <Pencil size={15} /> Edit profile
                      </button>
                      <Link to="/admin" className="btn btn--ghost btn--sm">
                        <Settings size={15} /> Dashboard
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        className={`btn btn--sm ${profile.is_following ? 'btn--secondary' : 'btn--primary'}`}
                        onClick={toggleFollow}
                        disabled={followBusy}
                      >
                        {profile.is_following ? <UserMinus size={15} /> : <UserPlus size={15} />}
                        {profile.is_following ? 'Following' : 'Follow'}
                      </button>
                      <Link
                        to={`/chat?to=${profile.username}`}
                        className="btn btn--secondary btn--sm"
                      >
                        <Mail size={15} /> Message
                      </Link>
                    </>
                  )}
                </div>
              </div>

              {profile.bio && <p className="profile-hero__bio">{profile.bio}</p>}

              <div className="row row--tight muted small mt-3" style={{ flexWrap: 'wrap', gap: 16 }}>
                {profile.location && <span className="row row--tight"><MapPin size={14} /> {profile.location}</span>}
                {profile.created_at && <span className="row row--tight"><CalendarDays size={14} /> Joined {profile.created_at.slice(0, 10)}</span>}
                {profile.website && (
                  <a className="row row--tight text-brand" href={profile.website} target="_blank" rel="noreferrer noopener">
                    <ExternalLink size={14} /> {profile.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {(profile.interests || '')
                  .split(',')
                  .filter(Boolean)
                  .map((interest) => <span className="tag" key={interest}>{interest}</span>)}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="stat-strip mt-5">
          <StatCell label="Events hosted" value={stats.events ?? 0} />
          <StatCell label="Attending" value={stats.attending ?? 0} />
          <StatCell label="Tickets" value={stats.tickets ?? 0} />
          <StatCell label="Followers" value={stats.followers ?? 0} />
          <StatCell label="Following" value={stats.following ?? 0} />
        </div>

        {/* Tabs */}
        <div className="mt-6">
          <TabBar tabs={visibleTabs} active={tab} onChange={changeTab} />

          {eventsLoading && events.length === 0 && <CardSkeletonGrid count={3} />}

          {!eventsLoading && events.length === 0 && (
            <EmptyState
              icon={<CalendarDays size={22} />}
              title={emptyTitle(tab, profile)}
              text={emptyText(tab, profile)}
              action={profile.is_me && tab === 'hosting'
                ? <Link to="/events/new" className="btn btn--primary"><Plus size={15} /> Create an event</Link>
                : <Link to="/discover" className="btn btn--secondary">Discover events</Link>}
            />
          )}

          {events.length > 0 && (
            <div className="grid grid--events">
              {events.map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          )}
        </div>

        {/* Organiser revenue strip (own profile) */}
        {profile.is_me && (stats.events || 0) > 0 && (
          <section className="section">
            <SectionHead
              title="Organiser tools"
              link={<Link to="/promotions" className="section-link">Promote an event</Link>}
            />
            <div className="grid grid--3">
              <Link to="/verify" className="panel panel--pad stat-card">
                <span className="cat-tile__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  <Ticket size={18} />
                </span>
                <div className="stat-card__value mt-4">Check in</div>
                <p className="small muted">Scan tickets at the door</p>
              </Link>
              <Link to="/promotions" className="panel panel--pad stat-card">
                <span className="cat-tile__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  <BadgeCheck size={18} />
                </span>
                <div className="stat-card__value mt-4">Promote</div>
                <p className="small muted">Featured, boosted and sponsored placements</p>
              </Link>
              <Link to="/tickets" className="panel panel--pad stat-card">
                <span className="cat-tile__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  <Bookmark size={18} />
                </span>
                <div className="stat-card__value mt-4">Tickets</div>
                <p className="small muted">Codes, QR passes and receipts</p>
              </Link>
            </div>
          </section>
        )}
      </div>

      {profile.is_me && <SignedInDevices />}

      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={profile}
        onSaved={(updated) => {
          patchUser(updated);
          reloadProfile();
          reloadEvents();
        }}
      />
    </div>
  );
}

/**
 * Where this account is signed in, and the switch to end any of it. Sessions
 * live on the server, so signing a device out here really does end it — even if
 * that device still holds a perfectly valid-looking token.
 */
function SignedInDevices() {
  const { toast } = useToast();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await api.get('/auth/sessions');
      setRows(data.sessions || []);
      setError('');
    } catch (err) {
      setError(err.message);
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const endSession = async (id) => {
    setBusy(id);
    try {
      await api.del(`/auth/sessions/${id}`);
      toast('That device has been signed out', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const endEverything = async () => {
    setBusy('all');
    try {
      await api.post('/auth/logout-all', {});
      toast('Signed out of every device', 'success');
      // The current session is gone too, so send the user to the sign-in page.
      window.location.assign('/login');
    } catch (err) {
      toast(err.message, 'error');
      setBusy('');
    }
  };

  return (
    <section className="section">
      <SectionHead title="Security" sub="Devices signed in to your account" />
      <div className="panel panel--pad">
        <div className="row row--between">
          <div className="row gap-3">
            <span className="cat-tile__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Signed-in devices</strong>
              <p className="small muted">End any session you do not recognise. Changing your password signs out every other device.</p>
            </div>
          </div>
          <button className="btn btn--secondary btn--sm" onClick={endEverything} disabled={busy === 'all'}>
            <LogOut size={14} />
            {busy === 'all' ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </div>

        {rows === null && <div className="mt-4"><LoadingBlock label="Loading sessions…" /></div>}
        {error && <p className="small text-danger mt-4">{error}</p>}

        {rows && rows.length > 0 && (
          <ul className="stack stack--sm mt-4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((row) => (
              <li key={row.id} className="row row--between" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <strong className="small">{row.label}{row.current ? ' · this device' : ''}</strong>
                  <p className="small muted">
                    Last active {timeAgo(row.last_seen_at)}
                    {row.ip ? ` · ${row.ip}` : ''}
                  </p>
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => endSession(row.id)}
                  disabled={busy === row.id}
                >
                  {busy === row.id ? 'Ending…' : row.current ? 'Sign out' : 'End session'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function emptyTitle(tab, profile) {
  if (tab === 'hosting') return profile.is_me ? 'You have not hosted an event yet' : `${profile.name} is not hosting anything yet`;
  if (tab === 'attending') return profile.is_me ? 'You have not registered for anything yet' : 'No public attendance yet';
  if (tab === 'saved') return 'No saved events';
  return 'Not following any events';
}

function emptyText(tab, profile) {
  if (tab === 'hosting') return 'Publish an event and it shows up here for everyone to discover.';
  if (tab === 'attending') return 'Register for a free event or buy a ticket and it appears in this list.';
  if (tab === 'saved') return 'Tap the bookmark on any event card to keep it here for later.';
  return 'Follow events to get updates when details change or tickets go live.';
}

function EditProfileModal({ open, onClose, user, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '', bio: '', location: '', phone: '', avatar_url: '', cover_url: '', password: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && user) {
      setForm({
        name: user.name || '',
        bio: user.bio || '',
        location: user.location || '',
        phone: user.phone || '',
        avatar_url: user.avatar_url || '',
        cover_url: user.cover_url || '',
        password: '',
      });
    }
  }, [open, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      const payload = await api.put('/users/me', form);
      toast('Profile updated', 'success');
      onSaved(payload.user);
      onClose();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit profile"
      size="wide"
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>Save changes</button>
        </>
      }
    >
      <div className="stack stack--lg">
        <div className="row" style={{ gap: 20, alignItems: 'flex-start' }}>
          <Avatar user={form} size="xl" />
          <div className="flex-1 stack">
            <MediaUploader
              kind="avatar"
              label="Profile picture"
              value={form.avatar_url}
              onChange={(url) => set({ avatar_url: url })}
              allowCamera
              allowVideoCapture={false}
            />
          </div>
        </div>

        <MediaUploader
          kind="cover"
          label="Profile banner"
          hint="Optional. A wide image works best (1600×500 or similar)."
          value={form.cover_url}
          onChange={(url) => set({ cover_url: url })}
          allowCamera={false}
        />

        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="p-name">Name</label>
            <input
              id="p-name"
              className="input"
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
              maxLength={80}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="p-location">Location</label>
            <input
              id="p-location"
              className="input"
              placeholder="Nairobi, Kenya"
              value={form.location}
              onChange={(event) => set({ location: event.target.value })}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="p-phone">Phone</label>
            <input
              id="p-phone"
              className="input"
              placeholder="+254 7…"
              value={form.phone}
              onChange={(event) => set({ phone: event.target.value })}
            />
            <span className="field__hint">Used to pre-fill M-Pesa payments. Never shown publicly.</span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="p-password">New password</label>
            <input
              id="p-password"
              className="input"
              type="password"
              placeholder="Leave blank to keep current"
              value={form.password}
              onChange={(event) => set({ password: event.target.value })}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="p-bio">Bio</label>
          <textarea
            id="p-bio"
            className="textarea"
            rows={3}
            maxLength={500}
            placeholder="Tell people what you organise or what you love attending."
            value={form.bio}
            onChange={(event) => set({ bio: event.target.value })}
          />
          <span className="field__hint">{500 - form.bio.length} characters left</span>
        </div>
      </div>
    </Modal>
  );
}
