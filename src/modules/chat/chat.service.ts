import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { SessionService } from '../session/session.service';

export interface ChatQueryOptions {
  isGroup?: boolean;
  archived?: boolean;
  pinned?: boolean;
  search?: string;
  sortBy?: 'name' | 'timestamp' | 'unread' | 'lastSynced';
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export interface MessageQueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp';
  order?: 'ASC' | 'DESC';
}

// In-memory store for active sync operations (for potential cancellation)
const activeSyncOperations = new Map<string, AbortController>();

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Chat, 'data')
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Message, 'data')
    private readonly messageRepository: Repository<Message>,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Get all chats from database for a session
   */
  async getChats(sessionId: string, options: ChatQueryOptions = {}): Promise<Chat[]> {
    const {
      isGroup,
      archived,
      pinned,
      search,
      sortBy = 'timestamp',
      order = 'DESC',
      limit = 1000,
      offset = 0,
    } = options;

    // Build where conditions
    const whereConditions: Record<string, unknown> = { sessionId };
    if (isGroup !== undefined) {
      whereConditions.isGroup = isGroup;
    }
    if (archived !== undefined) {
      whereConditions.archived = archived;
    }
    if (pinned !== undefined) {
      whereConditions.pinned = pinned;
    }

    // For MongoDB compatibility, fetch all and filter in memory
    let chats = await this.chatRepository.find({
      where: whereConditions,
    });

    // Apply search filter in memory
    if (search) {
      const searchLower = search.toLowerCase();
      chats = chats.filter(
        c => (c.name && c.name.toLowerCase().includes(searchLower)) || c.chatId.toLowerCase().includes(searchLower),
      );
    }

    // Apply sorting in memory
    chats.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = (a.name || '').localeCompare(b.name || '');
          break;
        case 'timestamp':
          comparison = (b.timestamp || 0) - (a.timestamp || 0);
          break;
        case 'unread':
          comparison = b.unreadCount - a.unreadCount;
          break;
        case 'lastSynced':
        default:
          comparison = (b.lastSyncedAt?.getTime() || 0) - (a.lastSyncedAt?.getTime() || 0);
      }
      return order === 'DESC' ? -comparison : comparison;
    });

    // Pagination
    return chats.slice(offset, offset + limit);
  }

  /**
   * Get a single chat by ID
   */
  async getChatById(sessionId: string, chatId: string): Promise<Chat | null> {
    return this.chatRepository.findOne({
      where: { sessionId, chatId },
    });
  }

  /**
   * Sleep utility for delays between operations
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save a single chat immediately (checkpoint pattern)
   * Stores chat metadata and all messages as separate documents
   * This ensures data is persisted even if sync is interrupted
   */
  private async saveChatCheckpoint(
    sessionId: string,
    waChat: any,
    messages: any[],
    existing: Chat | undefined,
    stats: { new: number; updated: number; totalMessages: number },
    fetchSucceeded = true,
  ): Promise<void> {
    try {
      // Prepare chat data (metadata only, no embedded messages)
      const lastMessageData = waChat.lastMessage
        ? {
            id: String(waChat.lastMessage.id || ''),
            body: waChat.lastMessage.body !== undefined ? String(waChat.lastMessage.body) : null,
            type: waChat.lastMessage.type !== undefined ? String(waChat.lastMessage.type) : 'chat',
            from: waChat.lastMessage.from !== undefined ? String(waChat.lastMessage.from) : null,
            to: waChat.lastMessage.to !== undefined ? String(waChat.lastMessage.to) : null,
            fromMe: Boolean(waChat.lastMessage.fromMe),
            timestamp: waChat.lastMessage.timestamp !== undefined ? Number(waChat.lastMessage.timestamp) : null,
            hasMedia: Boolean(waChat.lastMessage.hasMedia),
            ack: waChat.lastMessage.ack ?? null,
          }
        : null;

      if (existing) {
        // Update existing chat metadata
        let needsUpdate = false;

        if (waChat.name !== existing.name) {
          existing.name = waChat.name || null;
          needsUpdate = true;
        }
        if (waChat.isGroup !== existing.isGroup) {
          existing.isGroup = Boolean(waChat.isGroup);
          needsUpdate = true;
        }
        if (waChat.archived !== existing.archived) {
          existing.archived = Boolean(waChat.archived);
          needsUpdate = true;
        }
        if (waChat.pinned !== existing.pinned) {
          existing.pinned = Boolean(waChat.pinned);
          needsUpdate = true;
        }
        if (waChat.timestamp !== existing.timestamp) {
          existing.timestamp = waChat.timestamp !== undefined ? waChat.timestamp : null;
          needsUpdate = true;
        }
        if (waChat.unreadCount !== existing.unreadCount) {
          existing.unreadCount = waChat.unreadCount ?? 0;
          needsUpdate = true;
        }
        if (waChat.muteExpiration !== existing.muteExpiration) {
          existing.muteExpiration = waChat.muteExpiration ?? null;
          needsUpdate = true;
        }
        if (JSON.stringify(lastMessageData) !== JSON.stringify(existing.lastMessage)) {
          existing.lastMessage = lastMessageData;
          needsUpdate = true;
        }

        if (fetchSucceeded) {
          existing.messageCount = messages.length;
          needsUpdate = true;
        }

        if (needsUpdate) {
          existing.syncVersion = (existing.syncVersion || 0) + 1;
          existing.lastSyncedAt = new Date();
          await this.chatRepository.save(existing);
          stats.updated++;
        }

        if (fetchSucceeded) {
          // Delete old messages for this chat and insert new ones only when fetch succeeded
          await this.messageRepository.delete({ sessionId, chatId: waChat.id });
        }
      } else {
        // Insert new chat metadata
        const chatData = this.chatRepository.create({
          sessionId,
          chatId: waChat.id,
          name: waChat.name || null,
          isGroup: waChat.isGroup,
          archived: waChat.archived || false,
          pinned: waChat.pinned || false,
          timestamp: waChat.timestamp || null,
          unreadCount: waChat.unreadCount || 0,
          muteExpiration: waChat.muteExpiration || null,
          lastMessage: lastMessageData,
          messageCount: messages.length,
          syncVersion: 1,
          lastSyncedAt: new Date(),
        });
        await this.chatRepository.save(chatData);
        stats.new++;
      }

      // Insert all messages as separate documents
      if (fetchSucceeded && messages.length > 0) {
        const messageEntities = messages.map((msg: any) => {
          return this.messageRepository.create({
            sessionId,
            chatId: waChat.id,
            messageId: msg.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            body: msg.body !== undefined ? String(msg.body) : null,
            type: msg.type !== undefined ? String(msg.type) : 'chat',
            timestamp: msg.timestamp !== undefined ? Number(msg.timestamp) : null,
            from: msg.from !== undefined ? String(msg.from) : null,
            to: msg.to !== undefined ? String(msg.to) : null,
            fromMe: Boolean(msg.fromMe),
            hasMedia: Boolean(msg.hasMedia),
            mediaData: msg.mediaKey ? { mediaKey: msg.mediaKey, directPath: msg.directPath } : null,
            ack: msg.ack ?? null,
            quotedMessage: msg.quotedMsg ? JSON.parse(JSON.stringify(msg.quotedMsg)) : null,
            metadata: msg ? JSON.parse(JSON.stringify(msg)) : null,
          });
        });

        // Batch insert messages for efficiency
        const batchSize = 100;
        for (let i = 0; i < messageEntities.length; i += batchSize) {
          const batch = messageEntities.slice(i, i + batchSize);
          await this.messageRepository.save(batch);
        }
      }

      if (fetchSucceeded) {
        stats.totalMessages += messages.length;
      }
    } catch (err) {
      this.logger.error(
        `Failed to save checkpoint for chat ${waChat.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /**
   * Sync chats from WhatsApp to database with full message history
   * Uses checkpoint pattern - saves each chat immediately so data is not lost on interruption
   */
  async syncChats(
    sessionId: string,
    options?: {
      delayBetweenChatsMs?: number;
      delayBetweenMessagesMs?: number;
      maxMessagesPerChat?: number;
    },
  ): Promise<{ synced: number; new: number; updated: number; totalMessages: number; aborted?: boolean }> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }

    // Check if sync already running for this session
    if (activeSyncOperations.has(sessionId)) {
      throw new BadRequestException(
        'Sync already in progress for this session. Cancel it first or wait for completion.',
      );
    }

    const abortController = new AbortController();
    activeSyncOperations.set(sessionId, abortController);

    const {
      delayBetweenChatsMs = 2000,
      delayBetweenMessagesMs = 500,
      maxMessagesPerChat = 10000, // Default 10k messages per chat
    } = options || {};

    const stats = {
      synced: 0,
      new: 0,
      updated: 0,
      totalMessages: 0,
      aborted: false,
    };

    try {
      // Fetch chats from WhatsApp
      this.logger.log(`Fetching chats from WhatsApp for session ${sessionId}`);
      const whatsappChats = await engine.getAllChats();

      // Get existing chats to know which to update vs insert
      const existingChats = await this.chatRepository.find({
        where: { sessionId },
      });

      const existingMap = new Map(existingChats.map(c => [c.chatId, c]));

      this.logger.log(
        `Processing ${whatsappChats.length} chats with ${delayBetweenChatsMs}ms delay between each, fetching up to ${maxMessagesPerChat} messages per chat`,
      );

      for (let i = 0; i < whatsappChats.length; i++) {
        // Check if aborted
        if (abortController.signal.aborted) {
          this.logger.log(`Sync aborted for session ${sessionId} after processing ${stats.synced} chats`);
          stats.aborted = true;
          break;
        }

        const waChat = whatsappChats[i];
        const existing = existingMap.get(waChat.id);

        // Delay between chats to avoid rate limiting
        if (i > 0 && delayBetweenChatsMs > 0) {
          await this.sleep(delayBetweenChatsMs);
        }

        // Fetch ALL messages for this chat
        let chatMessages: any[] = [];
        let fetchSucceeded = true;
        try {
          this.logger.log(`Fetching messages for chat ${waChat.id} (${i + 1}/${whatsappChats.length})...`);
          chatMessages = (await engine.getChatHistory(waChat.id, maxMessagesPerChat)) as any[];
          this.logger.log(`Fetched ${chatMessages.length} messages for chat ${waChat.id}`);

          // Small delay after fetching messages
          if (delayBetweenMessagesMs > 0) {
            await this.sleep(delayBetweenMessagesMs);
          }
        } catch (msgErr) {
          fetchSucceeded = false;
          this.logger.warn(
            `Failed to fetch messages for chat ${waChat.id}: ${msgErr instanceof Error ? msgErr.message : 'Unknown error'}`,
          );
        }

        // Save immediately as checkpoint - data is persisted NOW, not at the end
        try {
          await this.saveChatCheckpoint(sessionId, waChat, chatMessages, existing, stats, fetchSucceeded);
          stats.synced++;
          this.logger.log(
            `Checkpoint saved: Chat ${i + 1}/${whatsappChats.length} - ${waChat.name || waChat.id} with ${chatMessages.length} messages`,
          );
        } catch (saveErr) {
          this.logger.error(
            `Failed to save checkpoint for chat ${waChat.id}: ${saveErr instanceof Error ? saveErr.message : 'Unknown error'}`,
          );
          // Continue to next chat even if one fails
        }
      }

      this.logger.log(
        `Sync ${stats.aborted ? 'aborted' : 'completed'} for session ${sessionId}: ${stats.synced} chats (${stats.new} new, ${stats.updated} updated, ${stats.totalMessages} total messages)`,
      );

      return {
        synced: stats.synced,
        new: stats.new,
        updated: stats.updated,
        totalMessages: stats.totalMessages,
        aborted: stats.aborted,
      };
    } catch (error) {
      this.logger.error(`Failed to sync chats for session ${sessionId}`, error);
      throw new BadRequestException(
        `Failed to sync chats: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      // Clean up
      activeSyncOperations.delete(sessionId);
    }
  }

  /**
   * Cancel an ongoing sync operation
   */
  cancelSync(sessionId: string): boolean {
    const controller = activeSyncOperations.get(sessionId);
    if (controller) {
      controller.abort();
      this.logger.log(`Sync cancellation requested for session ${sessionId}`);
      return true;
    }
    return false;
  }

  /**
   * Check if sync is in progress for a session
   */
  isSyncInProgress(sessionId: string): boolean {
    return activeSyncOperations.has(sessionId);
  }

  /**
   * Sync a single chat from WhatsApp
   */
  async syncSingleChat(sessionId: string, chatId: string): Promise<Chat | null> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }

    try {
      const waChat = await engine.getChatInfo(chatId);
      if (!waChat) {
        return null;
      }

      // Fetch messages for this chat
      let chatMessages: any[] = [];
      try {
        chatMessages = (await engine.getChatHistory(chatId, 10000)) as any[];
      } catch (msgErr) {
        this.logger.warn(
          `Failed to fetch messages for single chat sync ${chatId}: ${msgErr instanceof Error ? msgErr.message : 'Unknown error'}`,
        );
      }

      const existing = await this.getChatById(sessionId, chatId);
      const stats = { new: 0, updated: 0, totalMessages: 0 };

      await this.saveChatCheckpoint(sessionId, waChat, chatMessages, existing || undefined, stats);

      // Return the saved chat
      return this.getChatById(sessionId, chatId);
    } catch (error) {
      this.logger.error(`Failed to sync chat ${chatId} for session ${sessionId}`, error);
      throw new BadRequestException(`Failed to sync chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete all chats for a session (cleanup)
   */
  async deleteChatsBySession(sessionId: string): Promise<number> {
    const result = await this.chatRepository.delete({ sessionId });
    return result.affected || 0;
  }

  /**
   * Get chat statistics
   */
  async getChatStats(sessionId: string): Promise<{
    total: number;
    groups: number;
    archived: number;
    pinned: number;
    unreadTotal: number;
    lastSynced: string | null;
  }> {
    const allChats = await this.chatRepository.find({
      where: { sessionId },
    });

    const groups = allChats.filter(c => c.isGroup).length;
    const archived = allChats.filter(c => c.archived).length;
    const pinned = allChats.filter(c => c.pinned).length;
    const unreadTotal = allChats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    const lastSyncedChat = await this.chatRepository.findOne({
      where: { sessionId },
      order: { lastSyncedAt: 'DESC' },
    });

    return {
      total: allChats.length,
      groups,
      archived,
      pinned,
      unreadTotal,
      lastSynced: lastSyncedChat?.lastSyncedAt?.toISOString() || null,
    };
  }

  /**
   * Search all chats across all sessions (admin only)
   */
  async searchAllChats(searchQuery: string, limit = 100): Promise<Chat[]> {
    const allChats = await this.chatRepository.find();

    const searchLower = searchQuery.toLowerCase();
    return allChats
      .filter(
        c => (c.name && c.name.toLowerCase().includes(searchLower)) || c.chatId.toLowerCase().includes(searchLower),
      )
      .slice(0, limit);
  }
}
