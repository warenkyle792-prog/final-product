import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  ArrowLeft, CalendarDays, MessageSquarePlus, MessagesSquare, Search, Send, Users,
} from 'lucide-react';

import { Avatar, EmptyState, LoadingBlock, Modal } from '../components/UI';
import { api, getToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle, useIsMobile, useScrollLock } from '../hooks';
import { relativeDay, timeAgo } from '../utils/format';

export default function Chat() {
  useDocumentTitle('Messages');

  const { user, sessionExpired } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(Number(params.get('c')) || null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(null);
  const [online, setOnline] = useState({});
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState('');

  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  /* ------------------------------------------------------------ socket */
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return undefined;

    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('message:new', ({ conversationId, message }) => {
      if (conversationId === activeIdRef.current) {
        setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
      }
      setConversations((current) => current.map((conversation) => (
        conversation.id === conversationId
          ? { ...conversation, last_message: message }
          : conversation
      )));
    });

    socket.on('typing:start', ({ conversationId, userId }) => {
      if (conversationId === activeIdRef.current && userId !== user.id) setTyping(userId);
    });
    socket.on('typing:stop', ({ conversationId }) => {
      if (conversationId === activeIdRef.current) setTyping(null);
    });
    socket.on('presence:update', ({ userId, online: isOnline }) => {
      setOnline((current) => ({ ...current, [userId]: isOnline }));
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id]);

  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  /* --------------------------------------------------------- data load */
  const loadConversations = useCallback(async () => {
    try {
      const data = await api.get('/conversations');
      setConversations(data.conversations || []);
      return data.conversations || [];
    } catch (error) {
      // Session expiry is announced once by the toast layer; nothing to add here.
      if (error.status !== 401) toast(error.message, 'error');
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (user) loadConversations();
  }, [user, loadConversations]);

  /* Open a DM when arriving with ?to=username */
  useEffect(() => {
    const to = params.get('to');
    if (!to || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const { users } = await api.get(`/users?q=${encodeURIComponent(to)}`);
        const target = users.find((candidate) => candidate.username === to) || users[0];
        if (!target || cancelled) return;
        const { conversation } = await api.post('/conversations', { participantId: target.id });
        if (cancelled) return;
        await loadConversations();
        setActiveId(conversation.id);
        setParams({ c: String(conversation.id) }, { replace: true });
      } catch (error) {
        if (!cancelled) toast(error.message, 'error');
      }
    })();

    return () => { cancelled = true; };
  }, [params, user, loadConversations, setParams, toast]);

  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;

    setMessagesLoading(true);
    socketRef.current?.emit('conversation:join', activeId);

    api.get(`/conversations/${activeId}/messages`)
      .then((data) => { if (!cancelled) setMessages(data.messages || []); })
      .catch((error) => { if (!cancelled) toast(error.message, 'error'); })
      .finally(() => { if (!cancelled) setMessagesLoading(false); });

    return () => {
      socketRef.current?.emit('conversation:leave', activeId);
      if (!cancelled) { /* keep the list warm */ }
    };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the newest message in view.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, typing, activeId]);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || null,
    [conversations, activeId]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.participants?.map((p) => `${p.name} ${p.username}`).join(' '),
        conversation.last_message?.body,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [conversations, query]);

  const send = async (event) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || !activeId) return;
    setDraft('');
    socketRef.current?.emit('typing:stop', { conversationId: activeId });

    // Optimistic bubble, reconciled when the server echoes the message back.
    const optimistic = {
      id: `tmp-${Date.now()}`,
      conversation_id: activeId,
      sender_id: user.id,
      body,
      created_at: new Date().toISOString(),
      name: user.name,
      username: user.username,
      avatar_url: user.avatar_url,
      pending: true,
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const { message } = await api.post(`/conversations/${activeId}/messages`, { body });
      setMessages((current) => current.map((m) => (m.id === optimistic.id ? message : m)));
      setConversations((current) => current.map((conversation) => (
        conversation.id === activeId ? { ...conversation, last_message: message } : conversation
      )));
    } catch (error) {
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
      toast(error.message, 'error');
    }
  };

  const openConversation = (id) => {
    setActiveId(id);
    setParams({ c: String(id) }, { replace: true });
  };

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<MessagesSquare size={22} />}
            title={sessionExpired ? 'Your session ended' : 'Sign in to see your messages'}
            text={sessionExpired
              ? 'You were signed out, so your conversations are hidden. Sign in again and you will come straight back here.'
              : 'Talk to organisers about events or join an event group chat.'}
            action={<Link to="/login" state={{ from: '/chat' }} className="btn btn--primary">Sign in</Link>}
          />
        </div>
      </div>
    );
  }

  const showList = !isMobile || !activeId;
  const showThread = !isMobile || activeId;

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Messages</h1>
            <p>Direct messages with organisers and group chats for the events you follow.</p>
          </div>
          <button className="btn btn--primary" onClick={() => setNewOpen(true)}>
            <MessageSquarePlus size={16} /> New message
          </button>
        </div>

        <div className="chat">
          {showList && (
            <aside className="chat__sidebar">
              <div className="chat__sidebar-head">
                <span className="input-icon flex-1">
                  <Search size={15} />
                  <input
                    className="input"
                    placeholder="Search conversations"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search conversations"
                  />
                </span>
              </div>

              <div className="chat__list">
                {loading && <LoadingBlock label="Loading…" />}

                {!loading && filtered.length === 0 && (
                  <p className="muted small" style={{ padding: 'var(--s-4)' }}>
                    {conversations.length === 0
                      ? 'No conversations yet. Message an organiser from any event page.'
                      : 'Nothing matches that search.'}
                  </p>
                )}

                {filtered.map((conversation) => {
                  const other = conversation.participants?.[0];
                  const title = conversation.type === 'event'
                    ? conversation.title
                    : (other?.name || 'Conversation');
                  return (
                    <button
                      key={conversation.id}
                      className={`conv ${conversation.id === activeId ? 'is-active' : ''}`}
                      onClick={() => openConversation(conversation.id)}
                    >
                      {conversation.type === 'event' ? (
                        <span className="avatar avatar--md" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft)', color: 'var(--brand)', borderColor: 'transparent' }}>
                          <CalendarDays size={16} />
                        </span>
                      ) : (
                        <Avatar user={other} />
                      )}

                      <span className="conv__info">
                        <span className="conv__title">{title}</span>
                        <span className="conv__preview">
                          {conversation.last_message
                            ? `${conversation.last_message.sender_id === user.id ? 'You: ' : ''}${conversation.last_message.body}`
                            : 'No messages yet'}
                        </span>
                      </span>

                      {conversation.last_message && (
                        <span className="conv__time">{timeAgo(conversation.last_message.created_at)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          {showThread && (
            <section className="chat__main">
              {!active ? (
                <div className="chat__empty">
                  <MessagesSquare size={26} />
                  <div>
                    <strong>No conversation selected</strong>
                    <p className="small muted">Pick a thread on the left, or start a new message.</p>
                  </div>
                  <button className="btn btn--secondary btn--sm" onClick={() => setNewOpen(true)}>
                    <MessageSquarePlus size={15} /> New message
                  </button>
                </div>
              ) : (
                <>
                  <header className="chat__head">
                    {isMobile && (
                      <button className="btn btn--ghost btn--sm" onClick={() => setActiveId(null)} aria-label="Back to conversations">
                        <ArrowLeft size={16} />
                      </button>
                    )}

                    {active.type === 'event' ? (
                      <>
                        <span className="avatar avatar--md" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft)', color: 'var(--brand)', borderColor: 'transparent' }}>
                          <CalendarDays size={16} />
                        </span>
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="chat__head-title truncate">{active.title}</div>
                          <div className="chat__head-sub"><Users size={13} /> Event group chat</div>
                        </div>
                        <Link to={`/events/${active.event_id}`} className="btn btn--secondary btn--sm">Open event</Link>
                      </>
                    ) : (
                      <>
                        <Avatar user={active.participants?.[0]} />
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="chat__head-title truncate">{active.participants?.[0]?.name}</div>
                          <div className="chat__head-sub">
                            <span className={`presence ${online[active.participants?.[0]?.id] === false ? 'is-offline' : ''}`} />
                            {online[active.participants?.[0]?.id] === false ? 'Offline' : 'Active now'}
                          </div>
                        </div>
                        <Link to={`/u/${active.participants?.[0]?.username}`} className="btn btn--secondary btn--sm">Profile</Link>
                      </>
                    )}
                  </header>

                  <div className="chat__scroll" ref={scrollRef}>
                    {messagesLoading && <LoadingBlock label="Loading messages…" />}

                    {!messagesLoading && messages.length === 0 && (
                      <div className="chat__empty" style={{ padding: 0 }}>
                        <p className="small muted">
                          {active.type === 'event'
                            ? 'This is the start of the event group chat. Say hello to everyone going.'
                            : `Say hello to ${active.participants?.[0]?.name}.`}
                        </p>
                      </div>
                    )}

                    {messages.map((message, index) => {
                      const mine = message.sender_id === user.id;
                      const previous = messages[index - 1];
                      const showDay = !previous || dayKey(previous.created_at) !== dayKey(message.created_at);

                      return (
                        <div key={message.id}>
                          {showDay && <div className="day-divider">{relativeDay(message.created_at)}</div>}
                          <div className={`msg ${mine ? 'msg--mine' : ''}`} style={{ marginLeft: mine ? 'auto' : 0, opacity: message.pending ? 0.6 : 1 }}>
                            {!mine && <Avatar user={{ name: message.name, avatar_url: message.avatar_url }} size="sm" />}
                            <div>
                              <div className="msg__bubble">{message.body}</div>
                              <div className="msg__meta" style={{ textAlign: mine ? 'right' : 'left' }}>
                                {message.pending ? 'Sending…' : timeAgo(message.created_at)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {typing && <span className="small muted">typing…</span>}
                  </div>

                  <form className="chat__composer" onSubmit={send}>
                    <textarea
                      className="textarea flex-1"
                      rows={1}
                      placeholder="Write a message…"
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        socketRef.current?.emit('typing:start', { conversationId: activeId });
                      }}
                      onBlur={() => socketRef.current?.emit('typing:stop', { conversationId: activeId })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          send(event);
                        }
                      }}
                    />
                    <button className="btn btn--primary" disabled={!draft.trim()}>
                      <Send size={16} /> Send
                    </button>
                  </form>
                </>
              )}
            </section>
          )}
        </div>
      </div>

      <NewConversationModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onStarted={async (conversation) => {
          await loadConversations();
          openConversation(conversation.id);
        }}
      />
    </div>
  );
}

function dayKey(value) {
  return String(value || '').slice(0, 10);
}

function NewConversationModal({ open, onClose, onStarted }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('people');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    api.get('/users').then((data) => setPeople(data.users || [])).catch(() => {});
    api.get('/events?limit=8&sort=soon').then((data) => setEvents(data.events || [])).catch(() => {});
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) => (
      `${person.name} ${person.username} ${person.bio || ''}`.toLowerCase().includes(needle)
    ));
  }, [people, query]);

  const start = async (payload) => {
    setBusy(true);
    try {
      const { conversation } = await api.post('/conversations', payload);
      onStarted(conversation);
      onClose();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New message" size="md">
      <div className="segmented mb-4">
        <button type="button" className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
          People
        </button>
        <button type="button" className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
          Event group chats
        </button>
      </div>

      {tab === 'people' ? (
        <>
          <span className="input-icon mb-3" style={{ display: 'flex' }}>
            <Search size={15} />
            <input
              className="input"
              placeholder="Search people"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          </span>

          <div className="stack stack--sm" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {results.map((person) => (
              <button
                key={person.id}
                className="row row--tight w-full"
                style={{ padding: 10, borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left' }}
                disabled={busy}
                onClick={() => start({ participantId: person.id })}
              >
                <Avatar user={person} />
                <span className="flex-1">
                  <span className="medium" style={{ display: 'block' }}>{person.name}</span>
                  <span className="small muted">@{person.username}</span>
                </span>
              </button>
            ))}
            {results.length === 0 && <p className="small muted">No people match that search.</p>}
          </div>
        </>
      ) : (
        <div className="stack stack--sm" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {events.map((event) => (
            <button
              key={event.id}
              className="row row--tight w-full"
              style={{ padding: 10, borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left' }}
              disabled={busy}
              onClick={() => start({ eventId: event.id })}
            >
              <span className="avatar avatar--md" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-soft)', color: 'var(--brand)', borderColor: 'transparent' }}>
                <CalendarDays size={16} />
              </span>
              <span className="flex-1" style={{ minWidth: 0 }}>
                <span className="medium truncate" style={{ display: 'block' }}>{event.title}</span>
                <span className="small muted">{relativeDay(event.starts_at)} · {event.city || 'Online'}</span>
              </span>
            </button>
          ))}
          {events.length === 0 && <p className="small muted">No upcoming events to chat about.</p>}
        </div>
      )}
    </Modal>
  );
}
