import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, Check, Eye, ImageIcon, Info, Plus, Save,
  Ticket as TicketIcon, Trash2, Wand2,
} from 'lucide-react';

import EventCard from '../components/EventCard';
import MediaUploader from '../components/MediaUploader';
import {
  Avatar, LoadingBlock, Modal, Notice, Spinner, TabBar,
} from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';
import { formatMoney } from '../utils/format';

const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'UGX', 'TZS'];

const emptyTier = (index) => ({
  key: `tier-${Date.now()}-${index}`,
  name: index === 0 ? 'General admission' : `Ticket ${index + 1}`,
  description: '',
  price: 0,
  quantity: 100,
  per_user_limit: 6,
});

/** Local datetime string for <input type="datetime-local">. */
function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(18, 0, 0, 0);
  return toLocalInput(date);
}

export default function CreateEvent() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  useDocumentTitle(editing ? 'Edit event' : 'Create event');

  const [step, setStep] = useState('details');
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    title: '',
    tagline: '',
    category_id: '',
    description: '',
    venue: '',
    city: 'Nairobi',
    country: 'Kenya',
    starts_at: defaultStart(),
    ends_at: '',
    currency: 'KES',
    capacity: 200,
    image_url: '',
    video_url: '',
    tags: '',
    contact_email: '',
    contact_phone: '',
    use_tiers: false,
  });

  const [tiers, setTiers] = useState([emptyTier(0)]);

  useEffect(() => {
    api.get('/categories')
      .then((data) => {
        setCategories(data.categories || []);
        setForm((current) => (current.category_id ? current : { ...current, category_id: data.categories?.[0]?.id || '' }));
      })
      .catch(() => {});

    if (editing) {
      api.get(`/events/${id}`)
        .then(({ event }) => {
          if (event.host_id !== user?.id && !isAdmin) {
            toast('Only the organiser can edit this event', 'error');
            navigate(`/events/${event.id}`);
            return;
          }
          setForm({
            title: event.title || '',
            tagline: event.tagline || '',
            category_id: event.category_id || '',
            description: event.description || '',
            venue: event.venue || '',
            city: event.city || '',
            country: event.country || '',
            starts_at: event.starts_at ? toLocalInput(new Date(`${event.starts_at.replace(' ', 'T')}Z`)) : defaultStart(),
            ends_at: event.ends_at ? toLocalInput(new Date(`${event.ends_at.replace(' ', 'T')}Z`)) : '',
            currency: event.currency || 'KES',
            capacity: event.capacity || 0,
            image_url: event.image_url || '',
            video_url: event.video_url || '',
            tags: (event.tags || []).join(', '),
            contact_email: event.contact_email || '',
            contact_phone: event.contact_phone || '',
            use_tiers: (event.ticket_types || []).length > 1,
          });
          if ((event.ticket_types || []).length) {
            setTiers(event.ticket_types.map((tier, index) => ({
              key: `existing-${tier.id}`,
              id: tier.id,
              name: tier.name,
              description: tier.description || '',
              price: tier.price_cents / 100,
              quantity: tier.quantity,
              per_user_limit: tier.per_user_limit || 6,
              sold: tier.sold,
            })));
          }
        })
        .catch((err) => {
          toast(err.message, 'error');
          navigate('/events');
        })
        .finally(() => setLoading(false));
    }
  }, [editing, id, user?.id, isAdmin, navigate, toast]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const updateTier = (key, patch) => {
    setTiers((current) => current.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier)));
  };

  const addTier = () => setTiers((current) => [...current, emptyTier(current.length)]);

  const removeTier = (key) => {
    setTiers((current) => (current.length <= 1 ? current : current.filter((tier) => tier.key !== key)));
  };

  const lowestPrice = useMemo(() => {
    if (form.use_tiers) {
      const prices = tiers.map((tier) => Number(tier.price) || 0);
      return prices.length ? Math.min(...prices) : 0;
    }
    return Number(tiers[0]?.price) || 0;
  }, [form.use_tiers, tiers]);

  const totalCapacity = useMemo(() => {
    if (!form.use_tiers) return Number(form.capacity) || 0;
    return tiers.reduce((sum, tier) => sum + (Number(tier.quantity) || 0), 0);
  }, [form.use_tiers, tiers, form.capacity]);

  const previewEvent = useMemo(() => ({
    id: 'preview',
    title: form.title || 'Your event title',
    tagline: form.tagline,
    category_name: categories.find((c) => String(c.id) === String(form.category_id))?.name || 'Category',
    category_color: categories.find((c) => String(c.id) === String(form.category_id))?.color,
    image_url: form.image_url,
    starts_at: form.starts_at ? `${form.starts_at.replace('T', ' ')}:00` : new Date().toISOString(),
    venue: form.venue,
    city: form.city,
    price_cents: Math.round(lowestPrice * 100),
    currency: form.currency,
    is_free: lowestPrice === 0,
    host_name: user?.name || 'You',
    host_username: user?.username || '',
    host_avatar: user?.avatar_url || '',
    going_count: 0,
    follower_count: 0,
    sold: 0,
  }), [form, categories, lowestPrice, user]);

  const validate = () => {
    if (!form.title.trim()) return 'Give your event a name';
    if (!form.category_id) return 'Choose a category';
    if (!form.description.trim() || form.description.trim().length < 30) {
      return 'Add a description of at least 30 characters so attendees know what to expect';
    }
    if (!form.starts_at) return 'Set the start date and time';
    if (new Date(form.starts_at) < new Date() && !editing) return 'The start time must be in the future';
    if (!form.venue.trim() && !form.city.trim()) return 'Add a venue or a city';
    if (form.use_tiers && tiers.some((tier) => !tier.name.trim())) return 'Every ticket type needs a name';
    return '';
  };

  const submit = async (event) => {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        tagline: form.tagline.trim(),
        category_id: Number(form.category_id),
        description: form.description.trim(),
        venue: form.venue.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        starts_at: form.starts_at,
        ends_at: form.ends_at,
        currency: form.currency,
        capacity: totalCapacity,
        image_url: form.image_url,
        video_url: form.video_url,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim(),
        ticket_types: (form.use_tiers ? tiers : [tiers[0]]).map((tier) => ({
          id: tier.id,
          name: tier.name,
          description: tier.description,
          price_cents: Math.round((Number(tier.price) || 0) * 100),
          quantity: Number(tier.quantity) || 0,
          per_user_limit: Number(tier.per_user_limit) || 6,
        })),
      };

      const result = editing
        ? await api.put(`/events/${id}`, payload)
        : await api.post('/events', payload);

      toast(editing ? 'Event updated' : 'Event published', 'success');
      navigate(`/events/${result.event.id}`);
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <EmptyGate />
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="page"><div className="container"><LoadingBlock label="Loading event…" /></div></div>;
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>{editing ? 'Edit event' : 'Create an event'}</h1>
            <p>
              Fill in the essentials, add tickets and a cover, then publish. You can keep editing
              after it goes live — attendees keep the tickets they already bought.
            </p>
          </div>
          <button className="btn btn--secondary" type="button" onClick={() => setPreviewOpen(true)}>
            <Eye size={16} /> Preview
          </button>
        </div>

        {error && (
          <Notice tone="danger" icon={<AlertTriangle size={18} />} title="Please check the form">
            {error}
          </Notice>
        )}

        <TabBar
          tabs={[
            { id: 'details', label: 'Details', icon: <Info size={15} /> },
            { id: 'when', label: 'Date & location', icon: <CalendarDays size={15} /> },
            { id: 'tickets', label: 'Tickets', icon: <TicketIcon size={15} /> },
            { id: 'media', label: 'Cover & media', icon: <ImageIcon size={15} /> },
          ]}
          active={step}
          onChange={setStep}
        />

        <form onSubmit={submit} className="stack stack--lg" style={{ marginTop: 0 }}>
          {step === 'details' && (
            <div className="panel panel--pad stack stack--lg">
              <div className="form-grid">
                <div className="field full">
                  <label className="field__label" htmlFor="title">Event name <span className="req">*</span></label>
                  <input
                    id="title"
                    className="input"
                    value={form.title}
                    onChange={(e) => set({ title: e.target.value })}
                    placeholder="Jazz at the Arboretum"
                    maxLength={140}
                  />
                </div>

                <div className="field full">
                  <label className="field__label" htmlFor="tagline">Short tagline</label>
                  <input
                    id="tagline"
                    className="input"
                    value={form.tagline}
                    onChange={(e) => set({ tagline: e.target.value })}
                    placeholder="An evening of live jazz under the fig trees"
                    maxLength={200}
                  />
                  <p className="field__hint">One line that shows under the title on cards and search results.</p>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="category">Category <span className="req">*</span></label>
                  <select
                    id="category"
                    className="select"
                    value={form.category_id}
                    onChange={(e) => set({ category_id: e.target.value })}
                  >
                    <option value="">Choose a category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="tags">Tags</label>
                  <input
                    id="tags"
                    className="input"
                    value={form.tags}
                    onChange={(e) => set({ tags: e.target.value })}
                    placeholder="jazz, outdoors, family"
                  />
                  <p className="field__hint">Separate with commas — helps people find you in search.</p>
                </div>

                <div className="field full">
                  <label className="field__label" htmlFor="description">Description <span className="req">*</span></label>
                  <textarea
                    id="description"
                    className="textarea"
                    style={{ minHeight: 168 }}
                    value={form.description}
                    onChange={(e) => set({ description: e.target.value })}
                    placeholder={'What happens, who it is for, what to bring, and anything attendees should know…'}
                  />
                  <p className="field__hint">{form.description.trim().length} characters · 30 minimum</p>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="contact_email">Contact email</label>
                  <input
                    id="contact_email"
                    className="input"
                    type="email"
                    value={form.contact_email}
                    onChange={(e) => set({ contact_email: e.target.value })}
                    placeholder="events@yourdomain.co.ke"
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="contact_phone">Contact phone</label>
                  <input
                    id="contact_phone"
                    className="input"
                    type="tel"
                    value={form.contact_phone}
                    onChange={(e) => set({ contact_phone: e.target.value })}
                    placeholder="+254 712 345 678"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 'when' && (
            <div className="panel panel--pad stack stack--lg">
              <div className="form-grid">
                <div className="field">
                  <label className="field__label" htmlFor="starts_at">Starts at <span className="req">*</span></label>
                  <input
                    id="starts_at"
                    className="input"
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => set({ starts_at: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="ends_at">Ends at</label>
                  <input
                    id="ends_at"
                    className="input"
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(e) => set({ ends_at: e.target.value })}
                  />
                  <p className="field__hint">Optional, but it helps attendees plan the evening.</p>
                </div>

                <div className="field full">
                  <label className="field__label" htmlFor="venue">Venue</label>
                  <input
                    id="venue"
                    className="input"
                    value={form.venue}
                    onChange={(e) => set({ venue: e.target.value })}
                    placeholder="Nairobi Arboretum, Main Lawn"
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="city">City</label>
                  <input
                    id="city"
                    className="input"
                    value={form.city}
                    onChange={(e) => set({ city: e.target.value })}
                    placeholder="Nairobi"
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="country">Country</label>
                  <input
                    id="country"
                    className="input"
                    value={form.country}
                    onChange={(e) => set({ country: e.target.value })}
                    placeholder="Kenya"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 'tickets' && (
            <div className="panel panel--pad stack stack--lg">
              <div className="row row--between">
                <div>
                  <h3>Tickets</h3>
                  <p className="muted small">
                    One free tier is fine — add more when you need early bird pricing or VIP tables.
                  </p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={form.use_tiers}
                    onChange={(e) => set({ use_tiers: e.target.checked })}
                  />
                  <span className="switch__track" />
                  Multiple ticket types
                </label>
              </div>

              <div className="form-grid">
                <div className="field">
                  <label className="field__label" htmlFor="currency">Currency</label>
                  <select
                    id="currency"
                    className="select"
                    value={form.currency}
                    onChange={(e) => set({ currency: e.target.value })}
                  >
                    {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                  <p className="field__hint">M-Pesa supports KES. Cards support all listed currencies.</p>
                </div>

                {!form.use_tiers && (
                  <>
                    <div className="field">
                      <label className="field__label" htmlFor="single-price">Ticket price ({form.currency})</label>
                      <input
                        id="single-price"
                        className="input"
                        type="number"
                        min="0"
                        step="50"
                        value={tiers[0]?.price ?? 0}
                        onChange={(e) => updateTier(tiers[0].key, { price: e.target.value })}
                      />
                      <p className="field__hint">Set 0 for a free event — attendees then simply register.</p>
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor="single-qty">Available tickets</label>
                      <input
                        id="single-qty"
                        className="input"
                        type="number"
                        min="0"
                        step="10"
                        value={tiers[0]?.quantity ?? 0}
                        onChange={(e) => {
                          updateTier(tiers[0].key, { quantity: e.target.value });
                          set({ capacity: e.target.value });
                        }}
                      />
                      <p className="field__hint">0 means open capacity (no cap).</p>
                    </div>
                  </>
                )}
              </div>

              {form.use_tiers && (
                <div className="stack">
                  {tiers.map((tier, index) => (
                    <div className="panel panel--pad-sm" key={tier.key}>
                      <div className="row row--between mb-3">
                        <span className="eyebrow">Tier {index + 1}</span>
                        {tiers.length > 1 && (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeTier(tier.key)}>
                            <Trash2 size={14} /> Remove
                          </button>
                        )}
                      </div>

                      <div className="form-grid--3 form-grid">
                        <div className="field">
                          <label className="field__label">Name</label>
                          <input
                            className="input"
                            value={tier.name}
                            onChange={(e) => updateTier(tier.key, { name: e.target.value })}
                            placeholder="Early bird"
                          />
                        </div>
                        <div className="field">
                          <label className="field__label">Price ({form.currency})</label>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="50"
                            value={tier.price}
                            onChange={(e) => updateTier(tier.key, { price: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label className="field__label">Quantity</label>
                          <input
                            className="input"
                            type="number"
                            min={tier.sold || 0}
                            step="10"
                            value={tier.quantity}
                            onChange={(e) => updateTier(tier.key, { quantity: e.target.value })}
                          />
                          {tier.sold > 0 && <p className="field__hint">{tier.sold} already sold — cannot go lower.</p>}
                        </div>
                        <div className="field full">
                          <label className="field__label">Description</label>
                          <input
                            className="input"
                            value={tier.description}
                            onChange={(e) => updateTier(tier.key, { description: e.target.value })}
                            placeholder="What is included with this ticket?"
                          />
                        </div>
                        <div className="field">
                          <label className="field__label">Max per order</label>
                          <input
                            className="input"
                            type="number"
                            min="1"
                            max="50"
                            value={tier.per_user_limit}
                            onChange={(e) => updateTier(tier.key, { per_user_limit: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" className="btn btn--secondary" onClick={addTier}>
                    <Plus size={16} /> Add another ticket type
                  </button>
                </div>
              )}

              <Notice icon={<Wand2 size={18} />} title="How payments work">
                Checkout runs on the server: we calculate the total, ask the provider (M-Pesa or
                card) to collect it, and only issue tickets once the payment is confirmed. Refunds
                are handled from the admin dashboard.
              </Notice>

              <div className="stat-strip">
                <div className="stat-cell">
                  <strong>{lowestPrice === 0 ? 'Free' : formatMoney(Math.round(lowestPrice * 100), form.currency)}</strong>
                  <span>Lowest price</span>
                </div>
                <div className="stat-cell">
                  <strong>{totalCapacity || 'Open'}</strong>
                  <span>Total tickets</span>
                </div>
                <div className="stat-cell">
                  <strong>{form.use_tiers ? tiers.length : 1}</strong>
                  <span>Ticket types</span>
                </div>
              </div>
            </div>
          )}

          {step === 'media' && (
            <div className="panel panel--pad stack stack--lg">
              <MediaUploader
                kind="cover"
                value={form.image_url}
                onChange={(url) => set({ image_url: url })}
                label="Cover image"
                hint="PNG, JPG or WEBP · up to 8 MB · 16:9 works best on cards and the event page"
                allowCamera
              />

              <MediaUploader
                kind="video"
                value={form.video_url}
                onChange={(url) => set({ video_url: url })}
                label="Promo video (optional)"
                hint="MP4 or WebM · up to 80 MB. Shown instead of the cover image on the event page."
                allowCamera
                allowVideoCapture
              />

              <Notice icon={<Info size={18} />}>
                Camera access is only requested when you press <b>Take a photo</b> or{' '}
                <b>Record video</b>. You can always upload a file instead.
              </Notice>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setPreviewOpen(true)}>
              <Eye size={16} /> Preview
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <Spinner /> : editing ? <Save size={16} /> : <Check size={16} />}
              {editing ? 'Save changes' : 'Publish event'}
            </button>
          </div>
        </form>
      </div>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview"
        size="wide"
        footer={(
          <>
            <button className="btn btn--ghost" onClick={() => setPreviewOpen(false)}>Keep editing</button>
            <button className="btn btn--primary" onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : <Check size={16} />}
              {editing ? 'Save changes' : 'Publish event'}
            </button>
          </>
        )}
      >
        <div className="stack">
          <p className="muted small">This is how your event appears in listings.</p>
          <div className="grid grid--events" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <EventCard event={previewEvent} showFollow={false} />
          </div>

          <div className="panel panel--pad-sm">
            <div className="row row--tight">
              <Avatar user={user} />
              <div>
                <div className="medium">Organised by {user.name}</div>
                <div className="small muted">
                  {totalCapacity || 'Open capacity'} tickets · {lowestPrice === 0 ? 'Free entry' : `from ${formatMoney(Math.round(lowestPrice * 100), form.currency)}`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function EmptyGate() {
  return (
    <div className="empty">
      <div className="empty__icon"><TicketIcon size={22} /></div>
      <h3>Sign in to create an event</h3>
      <p>You need an account to publish events and manage ticket sales.</p>
      <div className="row row--tight" style={{ marginTop: 8 }}>
        <Link to="/login" className="btn btn--secondary">Sign in</Link>
        <Link to="/register" className="btn btn--primary">Create an account</Link>
      </div>
    </div>
  );
}
