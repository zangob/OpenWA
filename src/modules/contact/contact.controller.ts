import { Controller, Get, Post, Delete, Param, HttpCode, HttpStatus, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { SessionService } from '../session/session.service';
import { ContactService, ContactQueryOptions } from './contact.service';
import { Contact } from './entities/contact.entity';

@ApiTags('contacts')
@Controller('sessions/:sessionId/contacts')
export class ContactController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly contactService: ContactService,
  ) {}

  // ============================================================================
  // DATABASE-STORED CONTACTS (RECOMMENDED)
  // ============================================================================

  @Get('db')
  @ApiOperation({ summary: 'Get contacts from database (stored per session)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'isMyContact', required: false, type: Boolean, description: 'Filter by my contacts only' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name or number' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['name', 'number', 'recent', 'lastSeen'],
    description: 'Sort field',
  })
  @ApiQuery({ name: 'order', required: false, enum: ['ASC', 'DESC'], description: 'Sort order' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Limit results (default: 1000)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination' })
  @ApiResponse({ status: 200, description: 'List of contacts from database' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getContactsFromDb(
    @Param('sessionId') sessionId: string,
    @Query('isMyContact') isMyContact?: boolean,
    @Query('search') searchQuery?: string,
    @Query('sortBy') sortBy?: 'name' | 'number' | 'recent' | 'lastSeen',
    @Query('order') order?: 'ASC' | 'DESC',
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<Contact[]> {
    // Verify session exists
    const session = await this.sessionService.findOne(sessionId);
    if (!session) {
      throw new BadRequestException('Session not found');
    }

    const options: ContactQueryOptions = {
      isMyContact: isMyContact !== undefined ? isMyContact === true : undefined,
      searchQuery,
      sortBy,
      order,
      limit: limit ? parseInt(String(limit), 10) : 1000,
      offset: offset ? parseInt(String(offset), 10) : 0,
    };

    return this.contactService.getContacts(sessionId, options);
  }

  @Get('db/:contactId')
  @ApiOperation({ summary: 'Get a specific contact from database by ID' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({ status: 200, description: 'Contact details from database' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async getContactFromDb(
    @Param('sessionId') sessionId: string,
    @Param('contactId') contactId: string,
  ): Promise<Contact | null> {
    const contact = await this.contactService.getContactById(sessionId, contactId);
    if (!contact) {
      throw new BadRequestException(`Contact ${contactId} not found in database for session ${sessionId}`);
    }
    return contact;
  }

  @Get('db/number/:number')
  @ApiOperation({ summary: 'Get contact by phone number from database' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'number', description: 'Phone number (e.g., 628123456789)' })
  @ApiResponse({ status: 200, description: 'Contact details' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async getContactByNumberFromDb(
    @Param('sessionId') sessionId: string,
    @Param('number') number: string,
  ): Promise<Contact | null> {
    const contact = await this.contactService.getContactByNumber(sessionId, number);
    if (!contact) {
      throw new BadRequestException(`Contact with number ${number} not found in database for session ${sessionId}`);
    }
    return contact;
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync contacts from WhatsApp to database',
    description:
      'Fetches all contacts from WhatsApp and stores them in the database with sessionId to avoid conflicts between sessions',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Sync result with counts' })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  async syncContacts(@Param('sessionId') sessionId: string): Promise<{
    success: boolean;
    synced: number;
    new: number;
    updated: number;
    message: string;
  }> {
    const result = await this.contactService.syncContacts(sessionId);
    return {
      success: true,
      ...result,
      message: `Successfully synced ${result.synced} contacts (${result.new} new, ${result.updated} updated)`,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get contact statistics for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Contact statistics' })
  async getContactStats(@Param('sessionId') sessionId: string): Promise<{
    total: number;
    myContacts: number;
    blocked: number;
    withProfilePic: number;
    lastSynced: Date | null;
  }> {
    return this.contactService.getContactStats(sessionId);
  }

  @Delete('db')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all contacts for a session from database (cleanup)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Contacts deleted' })
  async deleteAllContacts(@Param('sessionId') sessionId: string): Promise<{
    success: boolean;
    deleted: number;
    message: string;
  }> {
    const count = await this.contactService.deleteContactsBySession(sessionId);
    return {
      success: true,
      deleted: count,
      message: `Deleted ${count} contacts from database for session ${sessionId}`,
    };
  }

  // ============================================================================
  // LIVE WHATSAPP CONTACTS (DIRECT FROM WHATSAPP - REAL-TIME)
  // ============================================================================

  @Get('live')
  @ApiOperation({
    summary: 'Get contacts directly from WhatsApp (live fetch)',
    description: 'Fetches contacts in real-time from WhatsApp. Does not store in database.',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'List of contacts from WhatsApp' })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  async getLiveContacts(@Param('sessionId') sessionId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }
    return engine.getContacts();
  }

  @Get('live/:contactId')
  @ApiOperation({
    summary: 'Get a specific contact directly from WhatsApp (live fetch)',
    description: 'Fetches contact in real-time from WhatsApp. Does not store in database.',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({ status: 200, description: 'Contact details from WhatsApp' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async getLiveContact(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }
    const contact = await engine.getContactById(contactId);
    if (!contact) {
      throw new BadRequestException(`Contact ${contactId} not found on WhatsApp`);
    }
    return contact;
  }

  @Post('live/:contactId/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync a single contact from WhatsApp to database',
    description: 'Fetches a specific contact from WhatsApp and saves/updates it in the database',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({ status: 200, description: 'Contact synced to database' })
  async syncSingleContact(
    @Param('sessionId') sessionId: string,
    @Param('contactId') contactId: string,
  ): Promise<{ success: boolean; contact: Contact | null; message: string }> {
    const contact = await this.contactService.syncSingleContact(sessionId, contactId);
    return {
      success: !!contact,
      contact,
      message: contact ? `Contact ${contactId} synced successfully` : `Failed to sync contact ${contactId}`,
    };
  }

  // ============================================================================
  // WHATSAPP OPERATIONS (PROFILE PICTURE, BLOCK, CHECK NUMBER)
  // ============================================================================

  @Get('check/:number')
  @ApiOperation({
    summary: 'Check if a phone number exists on WhatsApp',
    description: 'Verifies if the number is registered on WhatsApp',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'number', description: 'Phone number to check (e.g., 628123456789)' })
  @ApiResponse({ status: 200, description: 'Number existence check result' })
  async checkNumber(@Param('sessionId') sessionId: string, @Param('number') number: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }
    const exists = await engine.checkNumberExists(number);
    return {
      number,
      exists,
      whatsappId: exists ? `${number}@c.us` : null,
    };
  }

  @Get(':contactId/profile-picture')
  @ApiOperation({ summary: 'Get profile picture URL for a contact from WhatsApp' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({ status: 200, description: 'Profile picture URL' })
  async getProfilePicture(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }
    const url = await engine.getProfilePicture(contactId);

    // Update profile picture in database if exists
    await this.contactService.updateProfilePicture(sessionId, contactId, url || '');

    return { url };
  }

  @Post(':contactId/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a contact on WhatsApp' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({ status: 200, description: 'Contact blocked' })
  async blockContact(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }
    await engine.blockContact(contactId);

    // Sync to update block status in database
    await this.contactService.syncSingleContact(sessionId, contactId);

    return { success: true, message: 'Contact blocked' };
  }

  @Delete(':contactId/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unblock a contact on WhatsApp' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({ status: 200, description: 'Contact unblocked' })
  async unblockContact(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }
    await engine.unblockContact(contactId);

    // Sync to update block status in database
    await this.contactService.syncSingleContact(sessionId, contactId);

    return { success: true, message: 'Contact unblocked' };
  }
}
