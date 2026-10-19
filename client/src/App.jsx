import { Suspense, lazy, useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';

import Background from './components/Background';
import { EventQuickViewProvider } from './components/EventQuickView';
import MobileNav from './components/MobileNav';
import Navbar from './components/Navbar';
import { LoadingBlock } from './components/UI';

import Home from './pages/Home';
import Discover from './pages/Discover';
import Events from './pages/Events';
import EventDetails from './pages/EventDetails';
import CreateEvent from './pages/CreateEvent';
import Checkout from './pages/Checkout';
import Login from './pages/Login';
import Register from './pages/Register';

const Categories = lazy(() => import('./pages/Categories').then((module) => ({ default: module.Categories })));
const CategoryDetail = lazy(() => import('./pages/Categories').then((module) => ({ default: module.CategoryDetail })));
const Tickets = lazy(() => import('./pages/Tickets'));
const TicketDetail = lazy(() => import('./pages/TicketDetail'));
const Verify = lazy(() => import('./pages/Verify'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Profile = lazy(() => import('./pages/Profile'));
const Chat = lazy(() => import('./pages/Chat'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Admin = lazy(() => import('./pages/Admin'));
const NotFound = lazy(() => import('./pages/NotFound'));

/** Reset the scroll position whenever the route changes (but not on hash links). */
function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, hash]);

  return null;
}

function RouteFallback() {
  return (
    <div className="page">
      <div className="container">
        <LoadingBlock label="Loading…" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <EventQuickViewProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main">Skip to content</a>
        <Background />
        <ScrollToTop />
        <Navbar />

        <main id="main" className="app-main">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/events" element={<Events />} />
              <Route path="/events/new" element={<CreateEvent />} />
              <Route path="/events/:id" element={<EventDetails />} />
              <Route path="/events/:id/edit" element={<CreateEvent />} />
              <Route path="/checkout/:id" element={<Checkout />} />

              <Route path="/categories" element={<Categories />} />
              <Route path="/categories/:slug" element={<CategoryDetail />} />

              <Route path="/tickets" element={<Tickets />} />
              <Route path="/tickets/:code" element={<TicketDetail />} />
              <Route path="/verify" element={<Verify />} />

              <Route path="/promotions" element={<Promotions />} />
              <Route path="/notifications" element={<Notifications />} />

              <Route path="/profile" element={<Profile />} />
              <Route path="/u/:username" element={<Profile />} />

              <Route path="/chat" element={<Chat />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/admin" element={<Admin />} />

              <Route path="/saved" element={<SavedRedirect />} />
              <Route path="/following" element={<SavedRedirect />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>

        <MobileNav />
      </div>
    </EventQuickViewProvider>
  );
}

/** `/saved` and `/following` are shortcuts into the profile tabs. */
function SavedRedirect() {
  return (
    <div className="page">
      <div className="container">
        <div className="empty">
          <h1 className="empty__title">Your saved events live on your profile</h1>
          <p className="empty__text">Everything you bookmark or follow is collected in two tabs.</p>
          <div className="empty__actions">
            <Link to="/profile?tab=saved" className="btn btn--primary">Saved events</Link>
            <Link to="/profile?tab=following" className="btn btn--secondary">Events I follow</Link>
            <Link to="/discover" className="btn btn--ghost">Discover events</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
