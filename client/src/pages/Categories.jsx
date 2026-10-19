import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Grid2x2 } from 'lucide-react';

import EventCard from '../components/EventCard';
import { EmptyState, LoadingBlock, Pagination, SectionHead } from '../components/UI';
import { api } from '../api/client';
import { useAsync, useDocumentTitle } from '../hooks';

const GLYPHS = {
  music: '♪', technology: '⌘', sports: '▲', business: '▦',
  food: '◍', arts: '◐', community: '◎', wellness: '❋',
};

export function Categories() {
  useDocumentTitle('Categories');

  const { data, loading } = useAsync(() => api.get('/categories'), []);
  const categories = data?.categories || [];

  if (loading) return <div className="page"><div className="container"><LoadingBlock label="Loading categories…" /></div></div>;

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Categories</h1>
            <p>Eight ways to find your next event. Counts show how many are coming up right now.</p>
          </div>
        </div>

        <div className="grid grid--3">
          {categories.map((category) => (
            <Link key={category.slug} to={`/categories/${category.slug}`} className="panel panel--pad">
              <div className="row row--between">
                <span
                  className="cat-tile__icon"
                  style={{ background: category.color || 'var(--brand)', width: 44, height: 44 }}
                >
                  <span aria-hidden="true" style={{ fontSize: 19 }}>{GLYPHS[category.slug] || '✦'}</span>
                </span>
                <span className="badge">{category.event_count} upcoming</span>
              </div>

              <h2 className="mt-4" style={{ fontSize: 'var(--fs-lg)' }}>{category.name}</h2>
              <p className="muted small mt-2">{category.description}</p>

              <span className="section-link mt-4" style={{ display: 'inline-flex' }}>
                Browse {category.name.toLowerCase()} <ArrowRight size={15} />
              </span>
            </Link>
          ))}
        </div>

        {categories.length === 0 && (
          <EmptyState icon={<Grid2x2 size={22} />} title="No categories yet" />
        )}
      </div>
    </div>
  );
}

export function CategoryDetail() {
  const { slug } = useParams();
  const [page, setPage] = useBrowserPage();

  const { data, loading, error } = useAsync(
    () => api.get(`/categories/${slug}?limit=12&page=${page}`),
    [slug, page]
  );

  const category = data?.category;
  useDocumentTitle(category?.name || 'Category');

  if (loading && !data) return <div className="page"><div className="container"><LoadingBlock label="Loading category…" /></div></div>;

  if (error) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<Grid2x2 size={22} />}
            title="Category not found"
            text="That category does not exist."
            action={<Link to="/categories" className="btn btn--primary">All categories</Link>}
          />
        </div>
      </div>
    );
  }

  const events = data?.events || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 12));

  return (
    <div className="page">
      <div className="container">
        <div className="panel panel--pad mb-6" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0 }}>
          <span className="eyebrow">Category</span>
          <div className="row row--between mt-2">
            <h1 style={{ fontSize: 'var(--fs-2xl)' }}>{category?.name}</h1>
            <span className="badge">{data?.total || 0} upcoming events</span>
          </div>
          <p className="muted mt-2">{category?.description}</p>
        </div>

        {events.length === 0 ? (
          <EmptyState
            icon={<Grid2x2 size={22} />}
            title={`No upcoming ${category?.name.toLowerCase()} events`}
            text="Nothing is scheduled in this category right now. Follow the category to hear about new listings."
            action={<Link to="/discover" className="btn btn--primary">Browse everything</Link>}
          />
        ) : (
          <>
            <div className="grid grid--events">
              {events.map((event) => <EventCard key={event.id} event={event} />)}
            </div>
            <Pagination page={page} pages={pages} onChange={setPage} />
          </>
        )}

        {data?.related?.length > 0 && (
          <section className="section">
            <SectionHead title="Other categories" />
            <div className="chip-row">
              {data.related.map((item) => (
                <Link key={item.slug} to={`/categories/${item.slug}`} className="chip">
                  {item.name}
                  <span className="dim">{item.event_count}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Pagination that scrolls back to the top of the list. */
function useBrowserPage() {
  const [page, setPage] = useState(1);
  const change = (next) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return [page, change];
}
