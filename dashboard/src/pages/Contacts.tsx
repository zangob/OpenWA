import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Filter,
  Loader2,
  Send,
  User,
  Users,
  MessageCircle,
  MoreVertical,
  ArrowLeft,
  Phone,
  Check,
  CheckCheck,
  Clock,
  ChevronDown,
  RefreshCw,
  Database,
  Cloud,
  Calendar,
  Hash,
  Ban,
  Image as ImageIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import {
  contactsApi,
  chatsApi,
  sessionApi,
  messageApi,
  type ContactDb,
  type Chat,
  type ChatMessage,
  type ContactStats,
  type ChatDb,
  type ChatStats,
  type ChatSyncResult,
} from '../services/api';
import './Contacts.css';

interface Session {
  id: string;
  name: string;
  status: string;
}

export function Contacts() {
  const { t } = useTranslation();
  useDocumentTitle(t('contacts.title'));
  const toast = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // Database contacts
  const [contacts, setContacts] = useState<ContactDb[]>([]);
  const [contactStats, setContactStats] = useState<ContactStats | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Database chats
  const [chats, setChats] = useState<ChatDb[]>([]);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const [chatsLastSynced, setChatsLastSynced] = useState<string | null>(null);
  const [syncingChats, setSyncingChats] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ synced: number; total: number; messages: number } | null>(null);
  const [useDatabaseChats, setUseDatabaseChats] = useState(true);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'number' | 'recent' | 'lastSeen'>('name');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  const [showOnlyMyContacts, setShowOnlyMyContacts] = useState(false);
  const [showOnlyGroups, setShowOnlyGroups] = useState(false);

  // Data source toggle
  const [useDatabaseContacts, setUseDatabaseContacts] = useState(true);

  // Chat view states
  const [selectedChat, setSelectedChat] = useState<ChatDb | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactDb | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mobile view state
  const [showChatView, setShowChatView] = useState(false);

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
  }, []);

  // Fetch contacts and chats when session changes
  useEffect(() => {
    if (selectedSessionId) {
      if (useDatabaseContacts) {
        fetchContactsFromDb();
        fetchContactStats();
      }
      if (useDatabaseChats) {
        fetchChatsFromDb();
        fetchChatStats();
      } else {
        fetchLiveChats();
      }
    }
  }, [selectedSessionId, useDatabaseContacts, useDatabaseChats]);

  // Scroll to bottom when chat history changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const fetchSessions = async () => {
    try {
      const data = await sessionApi.list();
      const readySessions = data.filter(s => s.status === 'ready');
      setSessions(readySessions);
      if (readySessions.length > 0 && !selectedSessionId) {
        setSelectedSessionId(readySessions[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    }
  };

  const fetchContactsFromDb = async () => {
    if (!selectedSessionId) return;
    setLoading(true);
    try {
      const options = {
        isMyContact: showOnlyMyContacts || undefined,
        search: searchQuery || undefined,
        sortBy,
        order: sortOrder,
        limit: 1000,
      };
      const data = await contactsApi.listFromDb(selectedSessionId, options);
      setContacts(data);

      // Find last synced time from contacts
      const lastSync = data.length > 0
        ? data.reduce((latest, contact) => {
            if (!contact.lastSyncedAt) return latest;
            return !latest || new Date(contact.lastSyncedAt) > new Date(latest)
              ? contact.lastSyncedAt
              : latest;
          }, null as string | null)
        : null;
      setLastSynced(lastSync);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch contacts from database');
      toast.error(t('contacts.errorTitle'), t('contacts.errorFetch'));
    } finally {
      setLoading(false);
    }
  };

  const fetchContactStats = async () => {
    if (!selectedSessionId) return;
    try {
      const stats = await contactsApi.getStats(selectedSessionId);
      setContactStats(stats);
    } catch (err) {
      console.error('Failed to fetch contact stats:', err);
    }
  };

  const fetchChatsFromDb = async () => {
    if (!selectedSessionId) return;
    setLoading(true);
    try {
      const options = {
        isGroup: showOnlyGroups || undefined,
        search: searchQuery || undefined,
        sortBy: 'timestamp' as const,
        order: 'DESC' as const,
        limit: 1000,
      };
      const data = await chatsApi.listFromDb(selectedSessionId, options);
      setChats(data);

      // Find last synced time from chats
      const lastSync = data.length > 0
        ? data.reduce((latest, chat) => {
            if (!chat.lastSyncedAt) return latest;
            return !latest || new Date(chat.lastSyncedAt) > new Date(latest)
              ? chat.lastSyncedAt
              : latest;
          }, null as string | null)
        : null;
      setChatsLastSynced(lastSync);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch chats from database');
      toast.error(t('contacts.errorTitle'), t('contacts.errorFetch'));
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveChats = async () => {
    if (!selectedSessionId) return;
    try {
      const chatsData = await chatsApi.listLive(selectedSessionId);
      // Convert live chats to ChatDb format for consistency
      const liveChatsDb: ChatDb[] = chatsData.map(chat => ({
        id: chat.id,
        sessionId: selectedSessionId,
        chatId: chat.id,
        name: chat.name,
        isGroup: chat.isGroup,
        archived: chat.archived || false,
        pinned: chat.pinned || false,
        timestamp: chat.timestamp || null,
        unreadCount: chat.unreadCount,
        muteExpiration: null,
        lastMessage: chat.lastMessage || null,
        syncVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedAt: null,
      }));
      setChats(liveChatsDb);
      setChatsLastSynced(null);
    } catch (err) {
      console.error('Failed to fetch live chats:', err);
    }
  };

  const fetchChatStats = async () => {
    if (!selectedSessionId) return;
    try {
      const stats = await chatsApi.getStats(selectedSessionId);
      setChatStats(stats);
    } catch (err) {
      console.error('Failed to fetch chat stats:', err);
    }
  };

  const handleSyncChats = async () => {
    if (!selectedSessionId) return;
    setSyncingChats(true);
    setSyncProgress({ synced: 0, total: 0, messages: 0 });

    try {
      // Start sync with default settings (can be customized with options)
      const result = await chatsApi.sync(selectedSessionId, {
        delayBetweenChatsMs: 2000,
        delayBetweenMessagesMs: 500,
        maxMessagesPerChat: 10000,
      });

      const message = result.aborted
        ? `${t('chats.syncSuccess')} - ${result.synced} chats synced (${result.totalMessages} messages) - Sync was cancelled but data is saved`
        : `${t('chats.syncSuccess')} - ${result.synced} chats synced (${result.totalMessages} messages)`;

      toast.success(t('chats.syncSuccess'), message);

      // Refresh chats and stats
      await fetchChatsFromDb();
      await fetchChatStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sync chats';
      // If error is about sync already in progress, show different message
      if (msg.includes('already in progress')) {
        toast.warning(t('chats.syncInProgress'), t('chats.syncInProgressDesc'));
      } else {
        toast.error(t('chats.syncError'), msg);
      }
    } finally {
      setSyncingChats(false);
      setSyncProgress(null);
    }
  };

  const handleCancelSync = async () => {
    if (!selectedSessionId) return;
    try {
      const result = await chatsApi.cancelSync(selectedSessionId);
      if (result.success) {
        toast.info(t('chats.syncCancelRequested'), t('chats.syncCancelDesc'));
      } else {
        toast.info(t('chats.noSyncInProgress'), t('chats.noSyncInProgressDesc'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel sync';
      toast.error(t('chats.syncCancelError'), msg);
    }
  };

  const handleSyncContacts = async () => {
    if (!selectedSessionId) return;
    setSyncing(true);
    try {
      const result = await contactsApi.sync(selectedSessionId);
      toast.success(t('contacts.syncSuccess'), result.message);

      // Refresh contacts and stats
      await fetchContactsFromDb();
      await fetchContactStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sync contacts';
      toast.error(t('contacts.syncError'), msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectChat = async (chat: ChatDb) => {
    setSelectedChat(chat);
    setShowChatView(true);

    // Find associated contact from database
    const number = chat.chatId.replace(/@\w+$/, '');
    const contact = contacts.find(c => c.number === number || c.contactId === chat.chatId);
    setSelectedContact(contact || null);

    // If contact not in database but we're using DB mode, try to sync it
    if (!contact && useDatabaseContacts) {
      try {
        await contactsApi.syncSingle(selectedSessionId, chat.chatId);
        // Refresh contacts
        await fetchContactsFromDb();
      } catch {
        // Ignore sync error
      }
    }

    // Fetch chat history
    if (selectedSessionId) {
      setLoadingChat(true);
      try {
        const history = await chatsApi.getHistory(selectedSessionId, chat.chatId, 50);
        setChatHistory(history);
      } catch (err) {
        toast.error(t('contacts.errorTitle'), t('contacts.errorHistory'));
      } finally {
        setLoadingChat(false);
      }
    }
  };

  const handleSendMessage = async () => {
    if (!selectedSessionId || !selectedChat || !messageText.trim()) return;

    setSendingMessage(true);
    try {
      await messageApi.sendText(selectedSessionId, selectedChat.id, messageText.trim());
      setMessageText('');
      toast.success(t('contacts.messageSent'), t('contacts.messageSentDesc'));

      // Refresh chat history
      const history = await chatsApi.getHistory(selectedSessionId, selectedChat.id, 50);
      setChatHistory(history);
    } catch (err) {
      toast.error(t('contacts.errorTitle'), t('contacts.errorSend'));
    } finally {
      setSendingMessage(false);
    }
  };

  const handleBackToList = () => {
    setShowChatView(false);
    setSelectedChat(null);
    setSelectedContact(null);
    setChatHistory([]);
  };

  // Apply search filter to chats (for display)
  const getFilteredChats = useCallback(() => {
    let items = [...chats];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      items = items.filter(
        chat =>
          (chat.name?.toLowerCase() || '').includes(query) ||
          chat.chatId.toLowerCase().includes(query),
      );
    }

    // Filter by groups
    if (showOnlyGroups) {
      items = items.filter(item => item.isGroup);
    }

    // Merge with contact info from database
    items = items.map(chat => {
      const number = chat.chatId.replace(/@\w+$/, '');
      const contact = contacts.find(c => c.number === number || c.contactId === chat.chatId);

      return {
        ...chat,
        contactName: contact?.name || contact?.pushName,
        isMyContact: contact?.isMyContact,
        profilePicUrl: contact?.profilePicUrl,
      };
    });

    // Sort items
    items.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'number':
          return a.chatId.localeCompare(b.chatId);
        case 'recent':
        default:
          return (b.timestamp || 0) - (a.timestamp || 0);
      }
    });

    return items;
  }, [chats, contacts, searchQuery, showOnlyGroups, sortBy]);

  const chatListItems = getFilteredChats();

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatMessageTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getMessageStatusIcon = (ack?: number, fromMe?: boolean) => {
    if (!fromMe) return null;
    if (ack === 3) return <CheckCheck size={14} className="message-status read" />;
    if (ack === 2) return <CheckCheck size={14} className="message-status delivered" />;
    if (ack === 1) return <Check size={14} className="message-status sent" />;
    return <Clock size={14} className="message-status pending" />;
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatLastSync = (dateStr: string | null) => {
    if (!dateStr) return t('contacts.neverSynced');
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('contacts.justNow');
    if (diffMins < 60) return t('contacts.minAgo', { count: diffMins });
    if (diffHours < 24) return t('contacts.hoursAgo', { count: diffHours });
    return t('contacts.daysAgo', { count: diffDays });
  };

  return (
    <div className="contacts-page">
      <PageHeader
        title={t('contacts.title')}
        subtitle={t('contacts.subtitle')}
        actions={
          <div className="session-selector">
            <select
              value={selectedSessionId}
              onChange={e => setSelectedSessionId(e.target.value)}
              disabled={sessions.length === 0}
            >
              {sessions.length === 0 ? (
                <option value="">{t('contacts.noSessions')}</option>
              ) : (
                sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
            <ChevronDown size={16} className="select-icon" />
          </div>
        }
      />

      {/* Data Source Toggle & Sync */}
      {selectedSessionId && (
        <div className="contacts-toolbar">
          <div className="data-source-toggle">
            <button
              className={`source-btn ${useDatabaseContacts ? 'active' : ''}`}
              onClick={() => setUseDatabaseContacts(true)}
              title={t('contacts.dbModeDesc')}
            >
              <Database size={16} />
              <span>{t('contacts.dbMode')}</span>
            </button>
            <button
              className={`source-btn ${!useDatabaseContacts ? 'active' : ''}`}
              onClick={() => setUseDatabaseContacts(false)}
              title={t('contacts.liveModeDesc')}
            >
              <Cloud size={16} />
              <span>{t('contacts.liveMode')}</span>
            </button>
          </div>

          {useDatabaseContacts && (
            <button
              className="sync-btn"
              onClick={handleSyncContacts}
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              <span>{syncing ? t('contacts.syncing') : t('contacts.sync')}</span>
            </button>
          )}
        </div>
      )}

      {/* Chat Data Source Toggle & Sync */}
      {selectedSessionId && (
        <div className="contacts-toolbar" style={{ marginTop: '0.5rem' }}>
          <div className="data-source-toggle">
            <button
              className={`source-btn ${useDatabaseChats ? 'active' : ''}`}
              onClick={() => setUseDatabaseChats(true)}
              title={t('chats.dbModeDesc')}
            >
              <Database size={16} />
              <span>{t('chats.dbMode')}</span>
            </button>
            <button
              className={`source-btn ${!useDatabaseChats ? 'active' : ''}`}
              onClick={() => setUseDatabaseChats(false)}
              title={t('chats.liveModeDesc')}
            >
              <Cloud size={16} />
              <span>{t('chats.liveMode')}</span>
            </button>
          </div>

          {useDatabaseChats && (
            <div className="sync-actions">
              <button
                className="sync-btn"
                onClick={handleSyncChats}
                disabled={syncingChats}
              >
                {syncingChats ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                <span>{syncingChats ? t('chats.syncing') : t('chats.sync')}</span>
              </button>
              {syncingChats && (
                <button
                  className="cancel-sync-btn"
                  onClick={handleCancelSync}
                  title={t('chats.cancelSync')}
                >
                  <Ban size={16} />
                  <span>{t('chats.cancelSync')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contact Stats (DB Mode) */}
      {useDatabaseContacts && contactStats && (
        <div className="contact-stats">
          <div className="stat-card">
            <Hash size={20} />
            <div className="stat-info">
              <span className="stat-value">{contactStats.total}</span>
              <span className="stat-label">{t('contacts.stats.total')}</span>
            </div>
          </div>
          <div className="stat-card">
            <User size={20} />
            <div className="stat-info">
              <span className="stat-value">{contactStats.myContacts}</span>
              <span className="stat-label">{t('contacts.stats.myContacts')}</span>
            </div>
          </div>
          <div className="stat-card">
            <Ban size={20} />
            <div className="stat-info">
              <span className="stat-value">{contactStats.blocked}</span>
              <span className="stat-label">{t('contacts.stats.blocked')}</span>
            </div>
          </div>
          <div className="stat-card">
            <ImageIcon size={20} />
            <div className="stat-info">
              <span className="stat-value">{contactStats.withProfilePic}</span>
              <span className="stat-label">{t('contacts.stats.withPic')}</span>
            </div>
          </div>
          <div className="stat-card sync-info">
            <Calendar size={20} />
            <div className="stat-info">
              <span className="stat-value">{formatLastSync(lastSynced)}</span>
              <span className="stat-label">{t('contacts.stats.lastSync')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Chat Stats (DB Mode) */}
      {useDatabaseChats && chatStats && (
        <div className="contact-stats">
          <div className="stat-card">
            <Hash size={20} />
            <div className="stat-info">
              <span className="stat-value">{chatStats.total}</span>
              <span className="stat-label">{t('chats.stats.total')}</span>
            </div>
          </div>
          <div className="stat-card">
            <Users size={20} />
            <div className="stat-info">
              <span className="stat-value">{chatStats.groups}</span>
              <span className="stat-label">{t('chats.stats.groups')}</span>
            </div>
          </div>
          <div className="stat-card">
            <MessageCircle size={20} />
            <div className="stat-info">
              <span className="stat-value">{chatStats.archived}</span>
              <span className="stat-label">{t('chats.stats.archived')}</span>
            </div>
          </div>
          <div className="stat-card">
            <Check size={20} />
            <div className="stat-info">
              <span className="stat-value">{chatStats.pinned}</span>
              <span className="stat-label">{t('chats.stats.pinned')}</span>
            </div>
          </div>
          <div className="stat-card sync-info">
            <Calendar size={20} />
            <div className="stat-info">
              <span className="stat-value">{formatLastSync(chatsLastSynced)}</span>
              <span className="stat-label">{t('chats.stats.lastSync')}</span>
            </div>
          </div>
        </div>
      )}

      <div className={`contacts-container ${showChatView ? 'show-chat' : ''}`}>
        {/* Left Panel - Chat List */}
        <div className="chat-list-panel">
          {/* Search and Filters */}
          <div className="chat-list-header">
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                placeholder={t('contacts.searchPlaceholder')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="filter-bar">
              <div className="filter-group">
                <Filter size={14} />
                <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                  <option value="recent">{t('contacts.sort.recent')}</option>
                  <option value="name">{t('contacts.sort.name')}</option>
                  <option value="number">{t('contacts.sort.number')}</option>
                  {useDatabaseContacts && <option value="lastSeen">{t('contacts.sort.lastSeen')}</option>}
                </select>
              </div>

              {useDatabaseContacts && (
                <label className="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={showOnlyMyContacts}
                    onChange={e => {
                      setShowOnlyMyContacts(e.target.checked);
                      // Trigger fetch with new filter
                      setTimeout(() => fetchContactsFromDb(), 0);
                    }}
                  />
                  <User size={14} />
                  <span>{t('contacts.filter.myContacts')}</span>
                </label>
              )}

              <label className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={showOnlyGroups}
                  onChange={e => setShowOnlyGroups(e.target.checked)}
                />
                <Users size={14} />
                <span>{t('contacts.filter.groups')}</span>
              </label>
            </div>
          </div>

          {/* Chat List */}
          <div className="chat-list">
            {loading ? (
              <div className="chat-list-loading">
                <Loader2 className="animate-spin" size={24} />
                <p>{t('contacts.loading')}</p>
              </div>
            ) : chatListItems.length === 0 ? (
              <div className="chat-list-empty">
                <MessageCircle size={48} />
                <h3>{t('contacts.empty.title')}</h3>
                <p>{t('contacts.empty.description')}</p>
                {useDatabaseContacts && (
                  <button className="sync-btn-large" onClick={handleSyncContacts} disabled={syncing}>
                    {syncing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {t('contacts.syncing')}
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} />
                        {t('contacts.syncNow')}
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              chatListItems.map(item => (
                <div
                  key={item.chatId}
                  className={`chat-list-item ${selectedChat?.chatId === item.chatId ? 'active' : ''}`}
                  onClick={() => handleSelectChat(item)}
                >
                  <div className="chat-avatar">
                    {(item as any).profilePicUrl ? (
                      <img src={(item as any).profilePicUrl} alt={item.name || undefined} />
                    ) : (
                      <div className="avatar-placeholder">
                        {item.isGroup ? <Users size={20} /> : <span>{getInitials(item.name || '')}</span>}
                      </div>
                    )}
                  </div>

                  <div className="chat-info">
                    <div className="chat-header">
                      <h4 className="chat-name">{item.name || item.chatId}</h4>
                      {item.lastMessage && (item.lastMessage as any).timestamp && (
                        <span className="chat-time">{formatTime((item.lastMessage as any).timestamp)}</span>
                      )}
                    </div>

                    <div className="chat-preview">
                      {item.lastMessage ? (
                        <p className="last-message">
                          {(item.lastMessage as any).fromMe && <span className="from-me">{t('contacts.you')}: </span>}
                          {(item.lastMessage as any).body}
                        </p>
                      ) : (
                        <p className="no-message">{t('contacts.noMessages')}</p>
                      )}
                      {item.unreadCount > 0 && (
                        <span className="unread-badge">{item.unreadCount}</span>
                      )}
                    </div>

                    {/* Contact badges from database */}
                    {(item as any).isMyContact && (
                      <div className="contact-badges">
                        <span className="badge my-contact">{t('contacts.myContact')}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Chat View */}
        <div className="chat-view-panel">
          {selectedChat ? (
            <>
              {/* Chat Header */}
              <div className="chat-header-bar">
                <button className="back-button" onClick={handleBackToList}>
                  <ArrowLeft size={20} />
                </button>

                <div className="chat-header-info">
                  <div className="chat-avatar">
                    {selectedContact?.profilePicUrl ? (
                      <img src={selectedContact.profilePicUrl} alt={selectedChat.name || undefined} />
                    ) : (
                      <div className="avatar-placeholder">
                        {selectedChat.isGroup ? <Users size={20} /> : <User size={20} />}
                      </div>
                    )}
                  </div>

                  <div className="chat-title">
                    <h3>{selectedChat.name || selectedChat.chatId}</h3>
                    <span className="chat-subtitle">
                      {selectedChat.isGroup
                        ? t('contacts.group')
                        : selectedContact?.number || selectedChat.chatId.replace(/@\w+$/, '')}
                    </span>
                    {selectedContact?.isMyContact && (
                      <span className="contact-badge">{t('contacts.myContact')}</span>
                    )}
                  </div>
                </div>

                <button className="chat-menu-btn">
                  <MoreVertical size={20} />
                </button>
              </div>

              {/* Messages Area */}
              <div className="messages-area">
                {loadingChat ? (
                  <div className="messages-loading">
                    <Loader2 className="animate-spin" size={24} />
                  </div>
                ) : chatHistory.length === 0 ? (
                  <div className="messages-empty">
                    <MessageCircle size={48} />
                    <p>{t('contacts.noHistory')}</p>
                  </div>
                ) : (
                  <div className="messages-list">
                    {chatHistory.map((msg, index) => {
                      const showDate =
                        index === 0 ||
                        new Date(msg.timestamp * 1000).toDateString() !==
                          new Date(chatHistory[index - 1].timestamp * 1000).toDateString();

                      return (
                        <div key={msg.id}>
                          {showDate && (
                            <div className="message-date">
                              {new Date(msg.timestamp * 1000).toLocaleDateString()}
                            </div>
                          )}
                          <div className={`message ${msg.fromMe ? 'outgoing' : 'incoming'}`}>
                            <div className="message-bubble">
                              <p>{msg.body}</p>
                              <div className="message-meta">
                                <span className="message-time">
                                  {formatMessageTime(msg.timestamp)}
                                </span>
                                {getMessageStatusIcon(msg.ack, msg.fromMe)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Message Input */}
              <div className="message-input-area">
                <div className="message-input-wrapper">
                  <input
                    type="text"
                    placeholder={t('contacts.messagePlaceholder')}
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !sendingMessage && handleSendMessage()}
                    disabled={sendingMessage}
                  />
                  <button
                    className="send-btn"
                    onClick={handleSendMessage}
                    disabled={!messageText.trim() || sendingMessage}
                  >
                    {sendingMessage ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <Send size={20} />
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="no-chat-selected">
              <MessageCircle size={64} />
              <h3>{t('contacts.selectChat')}</h3>
              <p>{t('contacts.selectChatDesc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
