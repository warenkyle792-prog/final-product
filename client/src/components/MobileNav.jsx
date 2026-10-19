import { NavLink } from 'react-router-dom';
import { Compass, Home, MessageCircle, Plus, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Bottom navigation for phones and small tablets.
 * The active tab is highlighted; "Create" keeps the brand accent so the
 * primary action is always one tap away.
 */
export default function MobileNav() {
  const { user } = useAuth();

  const item = ({ isActive }) => `mobile-nav__item ${isActive ? 'active' : ''}`;

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <div className="mobile-nav__inner">
        <NavLink to="/" end className={item}>
          <Home size={19} />
          <span>Home</span>
        </NavLink>

        <NavLink to="/discover" className={item}>
          <Compass size={19} />
          <span>Discover</span>
        </NavLink>

        <NavLink to="/events/new" className="mobile-nav__item" aria-label="Create event">
          <span className="mobile-nav__create">
            <Plus size={18} />
          </span>
          <span>Create</span>
        </NavLink>

        <NavLink to="/chat" className={item}>
          <MessageCircle size={19} />
          <span>Chat</span>
        </NavLink>

        <NavLink to={user ? `/u/${user.username}` : '/login'} className={item}>
          <User size={19} />
          <span>Profile</span>
        </NavLink>
      </div>
    </nav>
  );
}
