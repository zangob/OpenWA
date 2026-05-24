// API Service Layer for OpenWA Dashboard
// Centralized API client with TypeScript types

const API_BASE_URL = '/api';

// =============================================================================
// Types
// =============================================================================

export interface Session {
  id: string;
  name: string;
  status: 'created' | 'idle' | 'initializing' | 'connecting' | 'qr_ready' | 'ready' | 'disconnected';
  phone?: string;
  pushName?: string;
  lastActive?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStats {
  total: number;
  active: number;
  ready: number;
  disconnected: number;
  byStatus: Record<string, number>;
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
}

export interface Webhook {
  id: string;
  sessionId: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  role: 'admin' | 'user' | 'readonly';
  allowedIps?: string[];
  allowedSessions?: string[];
  isActive: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  createdAt: string;
  apiKey?: string; // Only returned on creation
}

export interface AuditLog {
  id: string;
  action: string;
  severity: 'info' | 'warn' | 'error';
  apiKeyId?: string;
  apiKeyName?: string;
  sessionId?: string;
  sessionName?: string;
  ipAddress?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  errorMessage?: string;
  createdAt: string;
}

export interface MessageResponse {
  messageId: string;
  timestamp: number;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp?: string;
  details?: {
    database?: { status: string };
    redis?: { status: string };
    queue?: { status: string };
  };
}

export interface InfraStatus {
  database: { connected: boolean; type: string; host: string };
  redis: { connected: boolean; host: string; port: number };
  queue: {
    enabled: boolean;
    messages: { pending: number; completed: number; failed: number };
    webhooks: { pending: number; completed: number; failed: number };
  };
  storage: { type: 'local' | 's3'; path?: string; bucket?: string };
  engine: { type: string; headless: boolean };
}

export interface SaveConfigPayload {
  database?: {
    type: 'sqlite' | 'postgres';
    builtIn?: boolean;
    host?: string;
    port?: string;
    username?: string;
    password?: string;
    database?: string;
    poolSize?: number;
    sslEnabled?: boolean;
  };
  redis?: {
    enabled?: boolean;
    builtIn?: boolean;
    host?: string;
    port?: string;
    password?: string;
  };
  queue?: {
    enabled?: boolean;
  };
  storage?: {
    type: 'local' | 's3';
    builtIn?: boolean;
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3Endpoint?: string;
  };
  engine?: {
    headless?: boolean;
    sessionDataPath?: string;
    browserArgs?: string;
  };
}

export interface Settings {
  general: { apiBaseUrl: string; sessionTimeout: number; autoReconnect: boolean; debugMode: boolean };
  api: { rateLimit: number; rateLimitWindow: number; enableDocs: boolean };
  notifications: { emailEnabled: boolean; notificationEmail: string; webhookAlerts: boolean };
}

// =============================================================================
// API Client
// =============================================================================

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Get API key from sessionStorage for authentication
  const apiKey = sessionStorage.getItem('openwa_api_key');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// =============================================================================
// Session API
// =============================================================================

export const sessionApi = {
  list: () => request<Session[]>('/sessions'),
  get: (id: string) => request<Session>(`/sessions/${id}`),
  create: (name: string) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  start: (id: string) => request<Session>(`/sessions/${id}/start`, { method: 'POST' }),
  stop: (id: string) => request<Session>(`/sessions/${id}/stop`, { method: 'POST' }),
  getQR: (id: string) => request<{ qrCode: string; status: string }>(`/sessions/${id}/qr`),
  getStats: () => request<SessionStats>('/sessions/stats/overview'),
  getGroups: (id: string) => request<{ id: string; name: string }[]>(`/sessions/${id}/groups`),
};

// =============================================================================
// Webhook API
// =============================================================================

export const webhookApi = {
  listBySession: (sessionId: string) => request<Webhook[]>(`/sessions/${sessionId}/webhooks`),
  listAll: () => request<Webhook[]>('/webhooks'),
  get: (sessionId: string, id: string) => request<Webhook>(`/sessions/${sessionId}/webhooks/${id}`),
  create: (sessionId: string, data: { url: string; events: string[] }) =>
    request<Webhook>(`/sessions/${sessionId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (sessionId: string, id: string, data: Partial<Webhook>) =>
    request<Webhook>(`/sessions/${sessionId}/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (sessionId: string, id: string) =>
    request<void>(`/sessions/${sessionId}/webhooks/${id}`, { method: 'DELETE' }),
  test: (sessionId: string, id: string) =>
    request<{ success: boolean; statusCode?: number; error?: string }>(`/sessions/${sessionId}/webhooks/${id}/test`, {
      method: 'POST',
    }),
};

// =============================================================================
// API Key API
// =============================================================================

export const apiKeyApi = {
  list: () => request<ApiKey[]>('/auth/api-keys'),
  get: (id: string) => request<ApiKey>(`/auth/api-keys/${id}`),
  create: (data: {
    name: string;
    role: string;
    allowedIps?: string[];
    allowedSessions?: string[];
    expiresAt?: string;
  }) =>
    request<ApiKey>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<ApiKey>) =>
    request<ApiKey>(`/auth/api-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/auth/api-keys/${id}`, { method: 'DELETE' }),
  revoke: (id: string) => request<ApiKey>(`/auth/api-keys/${id}/revoke`, { method: 'POST' }),
};

// =============================================================================
// Audit/Logs API
// =============================================================================

export const auditApi = {
  list: (params?: { action?: string; severity?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const queryStr = query.toString();
    return request<{ data: AuditLog[]; total: number }>(`/audit${queryStr ? `?${queryStr}` : ''}`);
  },
};

// =============================================================================
// Message API
// =============================================================================

export const messageApi = {
  sendText: (sessionId: string, chatId: string, text: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-text`, {
      method: 'POST',
      body: JSON.stringify({ chatId, text }),
    }),
  sendImage: (sessionId: string, chatId: string, url: string, caption?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-image`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, caption }),
    }),
  sendVideo: (sessionId: string, chatId: string, url: string, caption?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-video`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, caption }),
    }),
  sendAudio: (sessionId: string, chatId: string, url: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-audio`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url }),
    }),
  sendDocument: (sessionId: string, chatId: string, url: string, filename?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-document`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, filename }),
    }),
};

// =============================================================================
// Health & Infrastructure API
// =============================================================================

export const healthApi = {
  check: () => request<HealthStatus>('/health'),
  ready: () => request<HealthStatus>('/health/ready'),
};

export const infraApi = {
  getStatus: () => request<InfraStatus>('/infra/status'),
  updateConfig: (config: Partial<InfraStatus>) =>
    request<InfraStatus>('/infra/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  saveConfig: (config: SaveConfigPayload) =>
    request<{ message: string; saved: boolean; envPath: string; profiles: string[] }>('/infra/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  restart: (profiles?: string[], profilesToRemove?: string[]) =>
    request<{
      message: string;
      restarting: boolean;
      profiles: string[];
      profilesToRemove: string[];
      estimatedTime: number;
    }>('/infra/restart', {
      method: 'POST',
      body: JSON.stringify({ profiles: profiles || [], profilesToRemove: profilesToRemove || [] }),
    }),
  healthCheck: () => request<{ status: string; timestamp: string }>('/infra/health'),
};

// =============================================================================
// Settings API
// =============================================================================

export const settingsApi = {
  get: () => request<Settings>('/settings'),
  update: (settings: Partial<Settings>) =>
    request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};

// =============================================================================
// Contact & Chat Types
// =============================================================================

export interface Contact {
  id: string;
  name?: string;
  pushName?: string;
  number: string;
  isMyContact: boolean;
  isBlocked?: boolean;
  profilePicture?: string;
  profilePicUrl?: string;
}

export interface ContactDb {
  id: string;
  sessionId: string;
  contactId: string;
  name: string | null;
  pushName: string | null;
  number: string;
  isMyContact: boolean;
  isBlocked: boolean;
  profilePicUrl: string | null;
  status: string | null;
  lastSeenAt: number | null;
  labels: string[] | null;
  metadata: Record<string, unknown> | null;
  syncVersion: number;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
}

export interface ContactSyncResult {
  success: boolean;
  synced: number;
  new: number;
  updated: number;
  message: string;
}

export interface ContactStats {
  total: number;
  myContacts: number;
  blocked: number;
  withProfilePic: number;
  lastSynced: string | null;
}

export interface ChatMessage {
  id: string;
  body: string;
  type: string;
  timestamp: number;
  from: string;
  to: string;
  fromMe: boolean;
  hasMedia: boolean;
  ack?: number;
  quotedMessage?: {
    id: string;
    body: string;
    from: string;
  };
}

export interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  timestamp?: number;
  unreadCount: number;
  lastMessage?: {
    id: string;
    body: string;
    type: string;
    timestamp: number;
    from: string;
    fromMe: boolean;
  };
  pinned?: boolean;
  archived?: boolean;
}

export interface ChatDb {
  id: string;
  sessionId: string;
  chatId: string;
  name: string | null;
  isGroup: boolean;
  archived: boolean;
  pinned: boolean;
  timestamp: number | null;
  unreadCount: number;
  muteExpiration: number | null;
  lastMessage: Record<string, unknown> | null;
  syncVersion: number;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
}

export interface ChatSyncResult {
  success: boolean;
  synced: number;
  new: number;
  updated: number;
  totalMessages: number;
  aborted: boolean;
  message: string;
}

export interface ChatStats {
  total: number;
  groups: number;
  archived: number;
  pinned: number;
  unreadTotal: number;
  lastSynced: string | null;
}

// =============================================================================
// Contact & Chat API
// =============================================================================

export const contactsApi = {
  // ========== DATABASE-STORED CONTACTS (RECOMMENDED) ==========

  // Get contacts from database (with search, filter, sort)
  listFromDb: (sessionId: string, options?: {
    isMyContact?: boolean;
    search?: string;
    sortBy?: 'name' | 'number' | 'recent' | 'lastSeen';
    order?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.isMyContact !== undefined) params.set('isMyContact', String(options.isMyContact));
    if (options?.search) params.set('search', options.search);
    if (options?.sortBy) params.set('sortBy', options.sortBy);
    if (options?.order) params.set('order', options.order);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<ContactDb[]>(`/sessions/${sessionId}/contacts/db${query}`);
  },

  // Get single contact from database
  getFromDb: (sessionId: string, contactId: string) =>
    request<ContactDb>(`/sessions/${sessionId}/contacts/db/${contactId}`),

  // Sync all contacts from WhatsApp to database
  sync: (sessionId: string) =>
    request<ContactSyncResult>(`/sessions/${sessionId}/contacts/sync`, { method: 'POST' }),

  // Get contact statistics from database
  getStats: (sessionId: string) =>
    request<ContactStats>(`/sessions/${sessionId}/contacts/stats`),

  // Delete all contacts for a session from database
  deleteAllFromDb: (sessionId: string) =>
    request<{ success: boolean; deleted: number; message: string }>(`/sessions/${sessionId}/contacts/db`, {
      method: 'DELETE',
    }),

  // ========== LIVE WHATSAPP CONTACTS (DIRECT FETCH) ==========

  // Get contacts directly from WhatsApp (real-time, not stored)
  listLive: (sessionId: string) => request<Contact[]>(`/sessions/${sessionId}/contacts/live`),

  // Get single contact directly from WhatsApp
  getLive: (sessionId: string, contactId: string) =>
    request<Contact>(`/sessions/${sessionId}/contacts/live/${contactId}`),

  // Sync single contact to database
  syncSingle: (sessionId: string, contactId: string) =>
    request<{ success: boolean; contact: ContactDb | null; message: string }>(
      `/sessions/${sessionId}/contacts/live/${contactId}/sync`,
      { method: 'POST' }
    ),

  // ========== WHATSAPP OPERATIONS ==========

  checkNumber: (sessionId: string, number: string) =>
    request<{ number: string; exists: boolean; whatsappId: string | null }>(`/sessions/${sessionId}/contacts/check/${number}`),
  getProfilePicture: (sessionId: string, contactId: string) =>
    request<{ url: string }>(`/sessions/${sessionId}/contacts/${contactId}/profile-picture`),
  block: (sessionId: string, contactId: string) =>
    request<{ success: boolean; message: string }>(`/sessions/${sessionId}/contacts/${contactId}/block`, {
      method: 'POST',
    }),
  unblock: (sessionId: string, contactId: string) =>
    request<{ success: boolean; message: string }>(`/sessions/${sessionId}/contacts/${contactId}/block`, {
      method: 'DELETE',
    }),
};

export const chatsApi = {
  // ========== DATABASE-STORED CHATS (RECOMMENDED) ==========

  // Get chats from database (with search, filter, sort)
  listFromDb: (sessionId: string, options?: {
    isGroup?: boolean;
    archived?: boolean;
    pinned?: boolean;
    search?: string;
    sortBy?: 'name' | 'timestamp' | 'unread' | 'lastSynced';
    order?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.isGroup !== undefined) params.set('isGroup', String(options.isGroup));
    if (options?.archived !== undefined) params.set('archived', String(options.archived));
    if (options?.pinned !== undefined) params.set('pinned', String(options.pinned));
    if (options?.search) params.set('search', options.search);
    if (options?.sortBy) params.set('sortBy', options.sortBy);
    if (options?.order) params.set('order', options.order);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<ChatDb[]>(`/sessions/${sessionId}/chats${query}`);
  },

  // Sync all chats from WhatsApp to database with full message history
  sync: (sessionId: string, options?: {
    delayBetweenChatsMs?: number;
    delayBetweenMessagesMs?: number;
    maxMessagesPerChat?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.delayBetweenChatsMs !== undefined) params.set('delayBetweenChatsMs', String(options.delayBetweenChatsMs));
    if (options?.delayBetweenMessagesMs !== undefined) params.set('delayBetweenMessagesMs', String(options.delayBetweenMessagesMs));
    if (options?.maxMessagesPerChat !== undefined) params.set('maxMessagesPerChat', String(options.maxMessagesPerChat));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<ChatSyncResult>(`/sessions/${sessionId}/chats/sync/whatsapp${query}`, { method: 'POST' });
  },

  // Cancel ongoing chat sync
  cancelSync: (sessionId: string) =>
    request<{ success: boolean; message: string }>(`/sessions/${sessionId}/chats/sync/cancel`, { method: 'POST' }),

  // Check if sync is in progress
  getSyncStatus: (sessionId: string) =>
    request<{ inProgress: boolean }>(`/sessions/${sessionId}/chats/sync/status`),

  // Get chat statistics from database
  getStats: (sessionId: string) =>
    request<ChatStats>(`/sessions/${sessionId}/chats/stats/overview`),

  // ========== LIVE WHATSAPP CHATS (DIRECT FETCH) ==========

  // Get chats directly from WhatsApp (real-time, not stored)
  listLive: (sessionId: string) => request<Chat[]>(`/sessions/${sessionId}/chats/live`),

  // Get single chat directly from WhatsApp
  getLive: (sessionId: string, chatId: string) => request<Chat>(`/sessions/${sessionId}/chats/${chatId}`),

  // Get chat history
  getHistory: (sessionId: string, chatId: string, limit?: number) =>
    request<ChatMessage[]>(`/sessions/${sessionId}/chats/${chatId}/history${limit ? `?limit=${limit}` : ''}`),
};

// =============================================================================
// Plugin Types
// =============================================================================

export interface Plugin {
  id: string;
  name: string;
  version: string;
  type: 'engine' | 'storage' | 'queue' | 'auth' | 'extension';
  description?: string;
  author?: string;
  status: 'installed' | 'enabled' | 'disabled' | 'error';
  config: Record<string, unknown>;
  builtIn: boolean;
  provides: string[];
  loadedAt?: string;
  enabledAt?: string;
  error?: string;
}

export interface Engine {
  id: string;
  name: string;
  enabled: boolean;
  features: string[];
}

// =============================================================================
// Plugins API
// =============================================================================

export const pluginsApi = {
  list: () => request<Plugin[]>('/plugins'),
  get: (id: string) => request<Plugin>(`/plugins/${id}`),
  enable: (id: string) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/enable`, {
      method: 'POST',
    }),
  disable: (id: string) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/disable`, {
      method: 'POST',
    }),
  updateConfig: (id: string, config: Record<string, unknown>) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  healthCheck: (id: string) => request<{ healthy: boolean; message?: string }>(`/plugins/${id}/health`),
  getEngines: () => request<Engine[]>('/infra/engines'),
  getCurrentEngine: () => request<{ engineType: string }>('/infra/engines/current'),
};
