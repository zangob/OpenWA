import { Controller, Get, Param, Query, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SessionService } from '../session/session.service';
import { ChatService, ChatQueryOptions } from './chat.service';
import { Chat } from './entities/chat.entity';

@ApiTags('chats')
@Controller('sessions/:sessionId/chats')
export class ChatController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly chatService: ChatService,
  ) {}

  private getEngine(sessionId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new Error('Session is not started');
    }
    return engine;
  }

  @Post('sync/whatsapp')
  @ApiOperation({ summary: 'Fetch all chats from WhatsApp and store full message history' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({
    name: 'delayBetweenChatsMs',
    required: false,
    type: Number,
    description: 'Delay between processing each chat in ms (default: 2000)',
  })
  @ApiQuery({
    name: 'delayBetweenMessagesMs',
    required: false,
    type: Number,
    description: 'Delay after fetching messages per chat in ms (default: 500)',
  })
  @ApiQuery({
    name: 'maxMessagesPerChat',
    required: false,
    type: Number,
    description: 'Max messages to fetch per chat (default: 10000)',
  })
  @ApiResponse({
    status: 200,
    description: 'Chats synced successfully with full message history',
    schema: {
      example: { synced: 50, new: 10, updated: 40, totalMessages: 50000, aborted: false },
    },
  })
  @ApiResponse({ status: 400, description: 'Session not ready or sync already in progress' })
  async syncChatsFromWhatsApp(
    @Param('sessionId') sessionId: string,
    @Query('delayBetweenChatsMs') delayBetweenChatsMs?: string,
    @Query('delayBetweenMessagesMs') delayBetweenMessagesMs?: string,
    @Query('maxMessagesPerChat') maxMessagesPerChat?: string,
  ) {
    const options = {
      delayBetweenChatsMs: delayBetweenChatsMs ? parseInt(delayBetweenChatsMs, 10) : 2000,
      delayBetweenMessagesMs: delayBetweenMessagesMs ? parseInt(delayBetweenMessagesMs, 10) : 500,
      maxMessagesPerChat: maxMessagesPerChat ? parseInt(maxMessagesPerChat, 10) : 10000,
    };
    return this.chatService.syncChats(sessionId, options);
  }

  @Post('sync/cancel')
  @ApiOperation({ summary: 'Cancel an ongoing chat sync operation' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Sync cancellation status',
    schema: {
      example: { success: true, message: 'Sync cancellation requested' },
    },
  })
  async cancelSync(@Param('sessionId') sessionId: string) {
    const cancelled = this.chatService.cancelSync(sessionId);
    return {
      success: cancelled,
      message: cancelled ? 'Sync cancellation requested' : 'No sync in progress for this session',
    };
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Check if chat sync is in progress' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Sync status',
    schema: {
      example: { inProgress: true },
    },
  })
  async getSyncStatus(@Param('sessionId') sessionId: string) {
    const inProgress = this.chatService.isSyncInProgress(sessionId);
    return { inProgress };
  }

  @Post('sync/single')
  @ApiOperation({ summary: 'Sync a specific chat from WhatsApp' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiBody({
    schema: {
      example: { chatId: '1234567890@c.us' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Chat synced successfully',
    type: Chat,
  })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async syncSingleChat(@Param('sessionId') sessionId: string, @Body() body: { chatId: string }): Promise<Chat | null> {
    return this.chatService.syncSingleChat(sessionId, body.chatId);
  }

  @Get('stats/overview')
  @ApiOperation({ summary: 'Get chat statistics for the session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Chat statistics',
    schema: {
      example: {
        total: 100,
        groups: 20,
        archived: 5,
        pinned: 3,
        unreadTotal: 150,
        lastSynced: '2026-05-23T10:00:00Z',
      },
    },
  })
  async getChatStats(@Param('sessionId') sessionId: string) {
    return this.chatService.getChatStats(sessionId);
  }

  @Get('live')
  @ApiOperation({ summary: 'Get chats in real-time from WhatsApp (not from database)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Live chats from WhatsApp',
  })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  async getLiveChats(@Param('sessionId') sessionId: string) {
    const engine = this.getEngine(sessionId);
    return engine.getAllChats();
  }

  @Get()
  @ApiOperation({ summary: 'Get all chats from database for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'isGroup', required: false, type: Boolean, description: 'Filter by group chats' })
  @ApiQuery({ name: 'archived', required: false, type: Boolean, description: 'Filter by archived status' })
  @ApiQuery({ name: 'pinned', required: false, type: Boolean, description: 'Filter by pinned status' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name or chat ID' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'Sort by: name, timestamp, unread, lastSynced',
  })
  @ApiQuery({ name: 'order', required: false, type: String, description: 'Sort order: ASC or DESC' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default 1000)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Results offset' })
  @ApiResponse({
    status: 200,
    description: 'List of chats from database',
    type: [Chat],
  })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  async getAllChats(
    @Param('sessionId') sessionId: string,
    @Query('isGroup') isGroup?: string,
    @Query('archived') archived?: string,
    @Query('pinned') pinned?: string,
    @Query('search') searchQuery?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Chat[]> {
    const options: ChatQueryOptions = {
      isGroup: isGroup !== undefined ? isGroup === 'true' : undefined,
      archived: archived !== undefined ? archived === 'true' : undefined,
      pinned: pinned !== undefined ? pinned === 'true' : undefined,
      search: searchQuery,
      sortBy: sortBy as any,
      order: order as 'ASC' | 'DESC',
      limit: limit ? parseInt(limit, 10) : 1000,
      offset: offset ? parseInt(offset, 10) : 0,
    };
    return this.chatService.getChats(sessionId, options);
  }

  @Get(':chatId/history')
  @ApiOperation({ summary: 'Get message history from a specific chat' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'chatId', description: 'Chat ID (e.g., 1234567890@c.us for contacts, 1234567890@g.us for groups)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max messages to fetch (default 50, max 100)',
  })
  @ApiResponse({
    status: 200,
    description: 'Chat message history from WhatsApp',
  })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async getChatHistory(
    @Param('sessionId') sessionId: string,
    @Param('chatId') chatId: string,
    @Query('limit') limit?: string,
  ) {
    const engine = this.getEngine(sessionId);
    const messageLimit = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    return engine.getChatHistory(chatId, messageLimit);
  }

  @Get(':chatId')
  @ApiOperation({ summary: 'Get detailed chat information' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'chatId', description: 'Chat ID' })
  @ApiResponse({
    status: 200,
    description: 'Chat details',
  })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async getChatInfo(@Param('sessionId') sessionId: string, @Param('chatId') chatId: string) {
    const engine = this.getEngine(sessionId);
    return engine.getChatInfo(chatId);
  }
}
