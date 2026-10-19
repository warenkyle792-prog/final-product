import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff, Sparkles, Ticket, Users } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';

export default function Register() {
  useDocumentTitle('Create an account');

  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', username: '', email: '', phone: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    const username = form.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      setError('Usernames are 3–24 characters: letters, numbers and underscores only.');
      return;
    }
    if (form.password.length < 6) {
      setError('Choose a password with at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        username,
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      toast('Account created — welcome to EventTracker', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="auth">
          <div className="auth__aside">
            <span className="eyebrow">Join EventTracker</span>
            <h2 className="auth__headline">Find your people. Fill your calendar.</h2>
            <ul className="stack mt-6">
              <li className="cta__item"><Sparkles size={17} /> Personalised picks based on what you follow</li>
              <li className="cta__item"><Ticket size={17} /> Instant QR tickets after a confirmed payment</li>
              <li className="cta__item"><Users size={17} /> Host events with real attendee lists and check-in</li>
            </ul>
          </div>

          <div className="auth__card panel panel--pad">
            <h1>Create your account</h1>
            <p className="muted">Free to join. It takes less than a minute.</p>

            <form className="mt-6 stack" onSubmit={submit}>
              {error && <div className="notice notice--danger"><span className="small">{error}</span></div>}

              <div className="field">
                <label className="field__label" htmlFor="reg-name">Full name</label>
                <input
                  id="reg-name"
                  className="input"
                  placeholder="Njeri Karanja"
                  value={form.name}
                  onChange={set('name')}
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="reg-username">Username</label>
                <input
                  id="reg-username"
                  className="input"
                  placeholder="njeri"
                  value={form.username}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value.toLowerCase() }))}
                  autoComplete="username"
                  maxLength={24}
                  required
                />
                <span className="field__hint">3–24 characters — letters, numbers and underscores.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="reg-email">Email</label>
                <input
                  id="reg-email"
                  className="input"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={set('email')}
                  autoComplete="email"
                  required
                />
                <span className="field__hint"><Check size={12} /> Used for ticket confirmations and receipts.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="reg-phone">Phone <span className="dim">(optional)</span></label>
                <input
                  id="reg-phone"
                  className="input"
                  placeholder="+254 7…"
                  value={form.phone}
                  onChange={set('phone')}
                  autoComplete="tel"
                />
                <span className="field__hint">Pre-fills M-Pesa when you pay. Never shown publicly.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="reg-password">Password</label>
                <div className="input-reveal">
                  <input
                    id="reg-password"
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 6 characters"
                    value={form.password}
                    onChange={set('password')}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="input-reveal__toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button className="btn btn--primary btn--lg btn--block" disabled={busy}>
                {busy ? 'Creating account…' : 'Create account'} {!busy && <ArrowRight size={17} />}
              </button>
            </form>

            <p className="auth__alt">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
