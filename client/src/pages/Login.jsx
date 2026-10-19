import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarCheck, Eye, EyeOff, KeyRound, ShieldCheck, Ticket } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';

const DEMO_ACCOUNTS = [
  { email: 'admin@eventtracker.app', label: 'Amina · platform admin' },
  { email: 'daniel@eventtracker.app', label: 'Daniel · organiser' },
  { email: 'njeri@eventtracker.app', label: 'Njeri · attendee' },
];

export default function Login() {
  useDocumentTitle('Sign in');

  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      // `login` resolves with the user, and the context already holds the session.
      const user = await login(form.email.trim(), form.password);
      toast(`Signed in as ${user?.name || 'your account'}`, 'success');
      // Straight to the home page after signing in. Only an interrupted
      // attempt at a protected page sends the user back to where they were going.
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (email) => {
    setForm({ email, password: 'password123' });
    setError('');
  };

  return (
    <div className="page">
      <div className="container">
        <div className="auth">
          <div className="auth__aside">
            <span className="eyebrow">EventTracker</span>
            <h2 className="auth__headline">Everything happening around you, in one place.</h2>
            <ul className="stack mt-6">
              <li className="cta__item"><CalendarCheck size={17} /> Follow events and hear about changes first</li>
              <li className="cta__item"><Ticket size={17} /> Buy tickets with M-Pesa or card — QR pass issued on confirmation</li>
              <li className="cta__item"><ShieldCheck size={17} /> Run your own events with real check-in and reporting</li>
            </ul>
          </div>

          <div className="auth__card panel panel--pad">
            <h1>Welcome back</h1>
            <p className="muted">Sign in to manage your tickets, events and messages.</p>

            <form className="auth__form mt-6" onSubmit={submit}>
              {error && <div className="notice notice--danger"><span className="small">{error}</span></div>}

              <div className="field">
                <label className="field__label" htmlFor="login-email">Email or username</label>
                <input
                  id="login-email"
                  className="input"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={set('email')}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="login-password">Password</label>
                <div className="input-reveal">
                  <input
                    id="login-password"
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Your password"
                    value={form.password}
                    onChange={set('password')}
                    autoComplete="current-password"
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
                {busy ? 'Signing in…' : 'Sign in'} {!busy && <ArrowRight size={17} />}
              </button>
            </form>

            <p className="auth__alt">
              New here? <Link to="/register">Create an account</Link>
            </p>

            <div className="demo-accounts">
              <div className="row row--tight mb-2">
                <KeyRound size={14} />
                <strong className="small">Demo accounts</strong>
              </div>
              <p className="tiny dim mb-3">All use the password <code className="mono">password123</code>.</p>
              <div className="stack stack--sm">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="demo-account"
                    onClick={() => useDemo(account.email)}
                  >
                    <span className="demo-account__email mono">{account.email}</span>
                    <span className="tiny dim">{account.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
