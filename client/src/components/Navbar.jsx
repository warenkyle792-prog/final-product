import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Calendar, CalendarPlus, ChevronDown, Compass, Grid2x2, Heart, Home, LogOut,
  Menu, MessageCircle, Moon, QrCode, Settings, Shield, Sun, Ticket, User, X,
} from 'lucide-react';

import { Avatar } from './UI';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { useDismiss } from '../hooks';

const LINKS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/categories', label: 'Categories', icon: Grid2x2 },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
];

function ThemeToggle({ compact = false }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      className="icon-btn"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      {!compact && <span className="sr-only">Toggle theme</span>}
    </button>
  );
}

export default function Navbar() {
  const { user, logout, isAdmin, isOrganizer } = useAuth();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef(null);

  useDismiss(menuRef, () => setMenuOpen(false), menuOpen);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setDrawerOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate('/');
  };

  return (
    <>
      <header className={`nav ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="container nav__inner">
          <Link to="/" className="brand" aria-label="EventTracker home">
            <span className="brand__mark">
              <Calendar size={17} />
            </span>
            <span>EventTracker</span>
          </Link>

          <nav className="nav__links" aria-label="Primary">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => `nav__link ${isActive ? 'active' : ''}`}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav__actions">
            <ThemeToggle />

            {user && (
              <Link
                to="/notifications"
                className={`icon-btn ${location.pathname === '/notifications' ? 'is-active' : ''}`}
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                title="Notifications"
              >
                <Bell size={18} />
                {unread > 0 && <span className="icon-btn__dot">{unread > 9 ? '9+' : unread}</span>}
              </Link>
            )}

            <Link to="/events/new" className="btn btn--primary btn--sm hide-nav-create">
              <CalendarPlus size={16} />
              Create event
            </Link>

            {user ? (
              <div className="account" ref={menuRef}>
                <button
                  className="account__trigger"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                >
                  <Avatar user={user} size="sm" />
                  <ChevronDown size={14} />
                </button>

                {menuOpen && (
                  <div className="account__menu" role="menu">
                    <div className="account__head">
                      <strong>{user.name}</strong>
                      <span>@{user.username}</span>
                      <div className="row row--tight" style={{ marginTop: 6 }}>
                        <span className={`badge ${isAdmin ? 'badge--brand' : ''}`}>
                          {isAdmin ? 'Administrator' : isOrganizer ? 'Organiser' : 'Member'}
                        </span>
                      </div>
                    </div>

                    <Link to={`/u/${user.username}`} className="menu-item" role="menuitem">
                      <User size={16} /> Profile
                    </Link>
                    <Link to="/tickets" className="menu-item" role="menuitem">
                      <Ticket size={16} /> My tickets
                    </Link>
                    <Link to="/profile?tab=saved" className="menu-item" role="menuitem">
                      <Heart size={16} /> Saved & following
                    </Link>
                    <Link to="/verify" className="menu-item" role="menuitem">
                      <QrCode size={16} /> Verify tickets
                    </Link>

                    <div className="menu-sep" />

                    <Link to="/events/new" className="menu-item" role="menuitem">
                      <CalendarPlus size={16} /> Create event
                    </Link>
                    <Link to="/promotions" className="menu-item" role="menuitem">
                      <Settings size={16} /> Promotions
                    </Link>

                    {isAdmin && (
                      <>
                        <div className="menu-sep" />
                        <Link to="/admin" className="menu-item" role="menuitem">
                          <Shield size={16} /> Admin dashboard
                        </Link>
                      </>
                    )}

                    <div className="menu-sep" />
                    <button className="menu-item menu-item--danger" onClick={handleLogout} role="menuitem">
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="btn btn--ghost btn--sm hide-sm">Sign in</Link>
                <Link to="/register" className="btn btn--primary btn--sm hide-sm">Get started</Link>
              </>
            )}

            <button
              className="icon-btn nav-menu-btn"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={drawerOpen}
            >
              {drawerOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>
      </header>

      {drawerOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="drawer" role="menu" aria-label="Menu">
            <div className="row row--between mb-3">
              <span className="brand">
                <span className="brand__mark"><Calendar size={16} /></span>
                <span>EventTracker</span>
              </span>
              <button className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <X size={18} />
              </button>
            </div>

            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className="nav__link">
                <link.icon size={18} /> {link.label}
              </NavLink>
            ))}

            <NavLink to="/events/new" className="nav__link">
              <CalendarPlus size={18} /> Create event
            </NavLink>
            <NavLink to="/categories" className="nav__link">
              <Grid2x2 size={18} /> Categories
            </NavLink>

            <div className="menu-sep" />

            {user ? (
              <>
                <NavLink to={`/u/${user.username}`} className="nav__link">
                  <User size={18} /> Profile
                </NavLink>
                <NavLink to="/tickets" className="nav__link">
                  <Ticket size={18} /> My tickets
                </NavLink>
                <NavLink to="/notifications" className="nav__link">
                  <Bell size={18} /> Notifications {unread > 0 && <span className="badge badge--brand">{unread}</span>}
                </NavLink>
                <NavLink to="/verify" className="nav__link">
                  <QrCode size={18} /> Verify tickets
                </NavLink>
                {isAdmin && (
                  <NavLink to="/admin" className="nav__link">
                    <Shield size={18} /> Admin dashboard
                  </NavLink>
                )}
                <button className="menu-item menu-item--danger mt-2" onClick={handleLogout}>
                  <LogOut size={18} /> Sign out
                </button>
              </>
            ) : (
              <div className="stack mt-2">
                <Link to="/login" className="btn btn--secondary btn--block">Sign in</Link>
                <Link to="/register" className="btn btn--primary btn--block">Create an account</Link>
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
