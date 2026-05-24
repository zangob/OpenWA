import { Controller, Post, Get, Param, Body, Query, HttpCode, HttpStatus, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MessageService } from './message.service';
import { BulkMessageService } from './bulk-message.service';
import { BulkUploadService, ParsedPhoneNumber } from './bulk-upload.service';
import { SendTextMessageDto, SendMediaMessageDto, MessageResponseDto } from './dto';
import { SendBulkMessageDto, BulkMessageResponseDto } from './dto/bulk-message.dto';
import { 
  BulkUploadOptionsDto, 
  BulkUploadMessageDto, 
  BulkUploadResponseDto,
  PhoneColumnType,
} from './dto/bulk-upload.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('messages')
@Controller('sessions/:sessionId/messages')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly bulkMessageService: BulkMessageService,
    private readonly bulkUploadService: BulkUploadService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get message history for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'chatId', required: false, description: 'Filter by chat ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max messages to return (default 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination' })
  @ApiResponse({
    status: 200,
    description: 'Message history',
  })
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Query('chatId') chatId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.messageService.getMessages(sessionId, {
      chatId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('send-text')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a text message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Message sent',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or invalid request',
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async sendText(@Param('sessionId') sessionId: string, @Body() dto: SendTextMessageDto): Promise<MessageResponseDto> {
    return this.messageService.sendText(sessionId, dto);
  }

  @Post('send-image')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send an image message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Image sent',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or invalid request',
  })
  async sendImage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMediaMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messageService.sendImage(sessionId, dto);
  }

  @Post('send-video')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a video message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Video sent',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or invalid request',
  })
  async sendVideo(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMediaMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messageService.sendVideo(sessionId, dto);
  }

  @Post('send-audio')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send an audio/voice message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Audio sent',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or invalid request',
  })
  async sendAudio(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMediaMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messageService.sendAudio(sessionId, dto);
  }

  @Post('send-document')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a document/file' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Document sent',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or invalid request',
  })
  async sendDocument(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMediaMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messageService.sendDocument(sessionId, dto);
  }

  // ========== Phase 3: Extended Messaging ==========

  @Post('send-location')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a location message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Location sent',
    type: MessageResponseDto,
  })
  async sendLocation(
    @Param('sessionId') sessionId: string,
    @Body() dto: { chatId: string; latitude: number; longitude: number; description?: string; address?: string },
  ): Promise<MessageResponseDto> {
    return this.messageService.sendLocation(sessionId, dto);
  }

  @Post('send-contact')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a contact card message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Contact sent',
    type: MessageResponseDto,
  })
  async sendContact(
    @Param('sessionId') sessionId: string,
    @Body() dto: { chatId: string; contactName: string; contactNumber: string },
  ): Promise<MessageResponseDto> {
    return this.messageService.sendContact(sessionId, dto);
  }

  @Post('send-sticker')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a sticker message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Sticker sent',
    type: MessageResponseDto,
  })
  async sendSticker(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMediaMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messageService.sendSticker(sessionId, dto);
  }

  @Post('reply')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Reply to a message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Reply sent',
    type: MessageResponseDto,
  })
  async reply(
    @Param('sessionId') sessionId: string,
    @Body() dto: { chatId: string; quotedMessageId: string; text: string },
  ): Promise<MessageResponseDto> {
    return this.messageService.reply(sessionId, dto);
  }

  @Post('forward')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Forward a message to another chat' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 201,
    description: 'Message forwarded',
    type: MessageResponseDto,
  })
  async forward(
    @Param('sessionId') sessionId: string,
    @Body() dto: { fromChatId: string; toChatId: string; messageId: string },
  ): Promise<MessageResponseDto> {
    return this.messageService.forward(sessionId, dto);
  }

  // ========== Phase 3: Reactions ==========

  @Post('react')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Add or remove a reaction to a message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Reaction added or removed. Send empty emoji to remove reaction.',
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or message not found',
  })
  async react(
    @Param('sessionId') sessionId: string,
    @Body() dto: { chatId: string; messageId: string; emoji: string },
  ): Promise<{ success: boolean }> {
    await this.messageService.reactToMessage(sessionId, dto);
    return { success: true };
  }

  @Get(':chatId/:messageId/reactions')
  @ApiOperation({ summary: 'Get reactions for a specific message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'chatId', description: 'Chat ID containing the message' })
  @ApiParam({ name: 'messageId', description: 'Message ID to get reactions for' })
  @ApiResponse({
    status: 200,
    description: 'List of reactions with senders',
  })
  async getReactions(
    @Param('sessionId') sessionId: string,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messageService.getMessageReactions(sessionId, chatId, messageId);
  }

  // ========== Delete Message ==========

  @Post('delete')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Delete a message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Message deleted',
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or message not found',
  })
  async deleteMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: { chatId: string; messageId: string; forEveryone?: boolean },
  ): Promise<{ success: boolean }> {
    await this.messageService.deleteMessage(sessionId, dto);
    return { success: true };
  }

  // ========== Bulk Messaging ==========

  @Post('send-bulk-file')
  @RequireRole(ApiKeyRole.OPERATOR)
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Upload CSV/Excel file with phone numbers and send bulk messages' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiBody({
    description: 'CSV or Excel file with phone numbers and optional message data',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV or Excel file (.csv, .xlsx, .xls)',
        },
        type: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'document'],
          default: 'text',
          description: 'Message type',
        },
        text: {
          type: 'string',
          description: 'Message text. Use {columnName} for variables from file',
          example: 'Hello {name}! Your order #{order_id} is ready.',
        },
        mediaUrl: {
          type: 'string',
          description: 'Media URL for image/video/audio/document messages',
        },
        mediaBase64: {
          type: 'string',
          description: 'Media base64 (alternative to URL)',
        },
        mimetype: {
          type: 'string',
          description: 'Media MIME type',
          example: 'image/jpeg',
        },
        filename: {
          type: 'string',
          description: 'Document filename',
          example: 'document.pdf',
        },
        phoneColumn: {
          type: 'string',
          enum: ['phone', 'mobile', 'number', 'whatsapp', 'custom'],
          default: 'phone',
          description: 'Phone number column name/type',
        },
        customColumnName: {
          type: 'string',
          description: 'Custom column name (if phoneColumn is custom)',
          example: 'mobile_number',
        },
        countryCode: {
          type: 'string',
          description: 'Country code to prepend if missing (e.g., +62, 62)',
          example: '+62',
        },
        delayBetweenMessages: {
          type: 'number',
          description: 'Delay between messages in ms (min: 1000, default: 3000)',
          default: 3000,
        },
        randomizeDelay: {
          type: 'boolean',
          description: 'Add random 0-2s to delay',
          default: true,
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop batch on first error',
          default: false,
        },
        maxNumbers: {
          type: 'number',
          description: 'Maximum numbers to process (0 = unlimited)',
          default: 0,
        },
        skipRows: {
          type: 'number',
          description: 'Skip first N rows (for header rows)',
          default: 0,
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Batch created and processing started',
    type: BulkUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file format, no valid phone numbers found, or session not active',
  })
  async sendBulkFromFile(
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: { fieldname: string; originalname: string; encoding: string; mimetype: string; buffer: Buffer; size: number },
    @Body() body: {
      type?: string;
      text?: string;
      mediaUrl?: string;
      mediaBase64?: string;
      mimetype?: string;
      filename?: string;
      phoneColumn?: string;
      customColumnName?: string;
      countryCode?: string;
      delayBetweenMessages?: string;
      randomizeDelay?: string;
      stopOnError?: string;
      maxNumbers?: string;
      skipRows?: string;
    },
  ): Promise<BulkUploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate message type
    const messageType = body.type || 'text';
    const validTypes = ['text', 'image', 'video', 'audio', 'document'];
    if (!validTypes.includes(messageType)) {
      throw new BadRequestException(`Invalid message type: ${messageType}. Use: ${validTypes.join(', ')}`);
    }

    // Validate text content for text messages
    if (messageType === 'text' && !body.text) {
      throw new BadRequestException('Message text is required for text messages');
    }

    // Parse file and extract phone numbers
    const parseOptions = {
      phoneColumn: body.phoneColumn as PhoneColumnType,
      customColumnName: body.customColumnName,
      skipRows: parseInt(body.skipRows || '0', 10),
      maxNumbers: parseInt(body.maxNumbers || '0', 10),
    };

    const { numbers, invalid, headers } = this.bulkUploadService.parseFile(
      file.buffer,
      file.mimetype,
      parseOptions,
    );

    if (numbers.length === 0) {
      throw new BadRequestException(
        `No valid phone numbers found. Invalid entries: ${invalid.map(i => `${i.original} (${i.error})`).join(', ')}`,
      );
    }

    // Add country code if provided and numbers don't have it
    let finalNumbers = numbers;
    if (body.countryCode) {
      finalNumbers = this.bulkUploadService.addCountryCode(numbers, body.countryCode);
    }

    // Build messages from file data
    const messages = finalNumbers.map(num => {
      // Apply template variables to text
      const text = body.text 
        ? this.bulkUploadService.applyVariables(body.text, num.rowData)
        : '';

      return {
        chatId: num.chatId,
        type: messageType as any,
        content: {
          text: messageType === 'text' ? text : undefined,
          caption: messageType !== 'text' ? text : undefined,
          image: messageType === 'image' ? { url: body.mediaUrl, base64: body.mediaBase64, mimetype: body.mimetype } : undefined,
          video: messageType === 'video' ? { url: body.mediaUrl, base64: body.mediaBase64, mimetype: body.mimetype } : undefined,
          audio: messageType === 'audio' ? { url: body.mediaUrl, base64: body.mediaBase64, mimetype: body.mimetype } : undefined,
          document: messageType === 'document' ? { 
            url: body.mediaUrl, 
            base64: body.mediaBase64, 
            mimetype: body.mimetype,
            filename: body.filename,
          } : undefined,
        },
        variables: num.rowData,
      };
    });

    // Create bulk message DTO
    const bulkDto: SendBulkMessageDto = {
      messages,
      options: {
        delayBetweenMessages: parseInt(body.delayBetweenMessages || '3000', 10),
        randomizeDelay: body.randomizeDelay !== 'false',
        stopOnError: body.stopOnError === 'true',
      },
    };

    // Create batch
    const batch = await this.bulkMessageService.createBatch(sessionId, bulkDto);
    const estimatedTime = new Date(
      Date.now() + batch.messages.length * (batch.options?.delayBetweenMessages || 3000),
    );

    return {
      batchId: batch.batchId,
      status: batch.status,
      totalNumbers: numbers.length + invalid.length,
      validNumbers: numbers.length,
      invalidNumbers: invalid.length,
      invalidNumbersList: invalid.slice(0, 10).map(i => `${i.original}: ${i.error}`), // Show first 10
      estimatedCompletionTime: estimatedTime.toISOString(),
      statusUrl: `/api/sessions/${sessionId}/messages/batch/${batch.batchId}`,
      message: `Bulk messaging started with ${numbers.length} valid numbers. Invalid: ${invalid.length}. ` +
        `Column '${body.phoneColumn || 'auto-detect'}' used. Headers found: ${headers.join(', ')}`,
    };
  }

  @Post('send-bulk')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send messages to multiple recipients (async batch processing)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 202,
    description: 'Batch created and processing started',
    type: BulkMessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Session not active or invalid request',
  })
  async sendBulk(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendBulkMessageDto,
  ): Promise<BulkMessageResponseDto> {
    const batch = await this.bulkMessageService.createBatch(sessionId, dto);
    const estimatedTime = new Date(Date.now() + batch.messages.length * (batch.options?.delayBetweenMessages || 3000));

    return {
      batchId: batch.batchId,
      status: batch.status,
      totalMessages: batch.messages.length,
      estimatedCompletionTime: estimatedTime.toISOString(),
      statusUrl: `/api/sessions/${sessionId}/messages/batch/${batch.batchId}`,
    };
  }

  @Get('batch/:batchId')
  @ApiOperation({ summary: 'Get batch processing status' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Batch ID' })
  @ApiResponse({
    status: 200,
    description: 'Batch status and progress',
  })
  @ApiResponse({
    status: 404,
    description: 'Batch not found',
  })
  async getBatchStatus(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    const batch = await this.bulkMessageService.getBatchStatus(sessionId, batchId);
    return {
      batchId: batch.batchId,
      status: batch.status,
      progress: batch.progress,
      results: batch.results,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
    };
  }

  @Post('batch/:batchId/cancel')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a running batch' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Batch ID' })
  @ApiResponse({
    status: 200,
    description: 'Batch cancelled',
  })
  @ApiResponse({
    status: 400,
    description: 'Batch already completed or cancelled',
  })
  @ApiResponse({
    status: 404,
    description: 'Batch not found',
  })
  async cancelBatch(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    const batch = await this.bulkMessageService.cancelBatch(sessionId, batchId);
    return {
      batchId: batch.batchId,
      status: batch.status,
      progress: batch.progress,
    };
  }
}
