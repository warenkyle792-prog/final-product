import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { initials } from '../utils/format';
import { useScrollLock } from '../hooks';

/* ---------------------------------------------------------------- Avatar */

export function Avatar({ user, src, size = 'md', alt = '', className = '' }) {
  const url = src ?? user?.avatar_url ?? '';
  const name = user?.name || alt || 'Member';
  const sizeClass = size === 'sm' || size === 'lg' || size === 'xl' ? `avatar--${size}` : 'avatar--md';

  if (url) {
    return (
      <img
        className={`avatar ${sizeClass} ${className}`}
        src={url}
        alt={name}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    );
  }

  return (
    <span className={`avatar-fallback ${sizeClass} ${className}`} aria-label={name} title={name}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 4, total }) {
  const shown = users.slice(0, max);
  const count = total ?? users.length;
  const extra = count - shown.length;

  return (
    <span className="avatar-stack" aria-hidden="true">
      {shown.map((user) => (
        <Avatar key={user.id ?? user.username} user={user} size="sm" />
      ))}
      {extra > 0 && <span className="more">+{extra}</span>}
    </span>
  );
}

/* -------------------------------------------------------------- Feedback */

export function Spinner({ size = 'md', label }) {
  return (
    <span className="row row--tight" role="status">
      <span className={`spinner ${size === 'lg' ? 'spinner--lg' : ''}`} aria-hidden="true" />
      {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <span className="spinner spinner--lg" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function CardSkeletonGrid({ count = 6 }) {
  return (
    <div className="grid grid--events">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}


/* ----------------------------------------------------------------- Modal */

export function Modal({ open, onClose, title, children, footer, size = 'md', closeOnScrim = true }) {
  useScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = size === 'wide' ? 'modal--wide' : size === 'narrow' ? 'modal--narrow' : '';

  return (
    <div
      className="modal-scrim"
      onClick={closeOnScrim ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : 'Dialog'}
    >
      <div className={`modal ${sizeClass}`} onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, text, confirmLabel = 'Confirm', danger = false, busy = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="narrow"
      footer={(
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </>
      )}
    >
      <p style={{ color: 'var(--text-1)' }}>{text}</p>
    </Modal>
  );
}

/* -------------------------------------------------------------- Sections */

export function SectionHead({ title, icon, sub, link }) {
  return (
    <div className="section-head">
      <div className="section-head__text">
        <h2 className="section-title">
          {icon}
          {title}
        </h2>
        {sub && <p className="section-sub">{sub}</p>}
      </div>
      {link}
    </div>
  );
}

export function StatusPill({ status, children }) {
  const value = String(status || 'pending').toLowerCase();
  return <span className={`status-pill status-pill--${value}`}>{children || value.replace(/_/g, ' ')}</span>;
}

export function MetaItem({ icon, label, value, sub }) {
  return (
    <div className="meta-item">
      {icon && <span className="meta-item__icon">{icon}</span>}
      <div className="flex-1">
        <div className="meta-item__label">{label}</div>
        <div className="meta-item__value">{value}</div>
        {sub && <div className="meta-item__sub">{sub}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, icon, foot, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-card__head">
        <span className="stat-card__label">{label}</span>
        {icon && (
          <span className="stat-card__icon" style={tone ? { color: tone, background: 'transparent' } : undefined}>
            {icon}
          </span>
        )}
      </div>
      <div className="stat-card__value">{value}</div>
      {foot && <div className="stat-card__foot">{foot}</div>}
    </div>
  );
}

/** Compact inline stat, used inside `.stat-strip` profile headers. */
export function StatCell({ label, value }) {
  return (
    <div className="stat-cell">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------ Pagination */

export function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const numbers = [];
  for (let i = start; i <= end; i += 1) numbers.push(i);

  return (
    <nav className="pagination" aria-label="Pagination">
      <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      {start > 1 && (
        <>
          <button className="page-btn" onClick={() => onChange(1)}>1</button>
          {start > 2 && <span className="dim" style={{ padding: '0 4px' }}>…</span>}
        </>
      )}
      {numbers.map((number) => (
        <button
          key={number}
          className={`page-btn ${number === page ? 'active' : ''}`}
          onClick={() => onChange(number)}
          aria-current={number === page ? 'page' : undefined}
        >
          {number}
        </button>
      ))}
      {end < pages && (
        <>
          {end < pages - 1 && <span className="dim" style={{ padding: '0 4px' }}>…</span>}
          <button className="page-btn" onClick={() => onChange(pages)}>{pages}</button>
        </>
      )}
      <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
          {tab.count != null && <span className="tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Notice({ icon, title, children, tone = 'default' }) {
  const toneClass = tone === 'default' ? '' : `notice--${tone}`;
  return (
    <div className={`notice ${toneClass}`}>
      {icon}
      <div className="flex-1">
        {title && <div className="notice__title">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}
