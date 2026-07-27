import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from './entities/contact.entity';
import { SessionService } from '../session/session.service';
import { createLogger } from '../../common/services/logger.service';

export interface ContactQueryOptions {
  isMyContact?: boolean;
  searchQuery?: string;
  sortBy?: 'name' | 'number' | 'recent' | 'lastSeen';
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export interface ContactFromWhatsApp {
  id: string;
  name?: string;
  pushName?: string;
  number: string;
  isMyContact: boolean;
  isBlocked?: boolean;
  profilePicUrl?: string;
}

@Injectable()
export class ContactService {
  private readonly logger = createLogger(ContactService.name);

  constructor(
    @InjectRepository(Contact, 'data')
    private readonly contactRepository: Repository<Contact>,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Get contacts from database for a session
   */
  async getContacts(sessionId: string, options: ContactQueryOptions = {}): Promise<Contact[]> {
    const { isMyContact, searchQuery, sortBy = 'name', order = 'ASC', limit = 1000, offset = 0 } = options;

    // Fetch all contacts for the session (compatible with SQLite, Postgres, and MongoDB)
    const whereClause: Record<string, unknown> = { sessionId };
    if (isMyContact !== undefined) {
      whereClause.isMyContact = isMyContact;
    }

    let contacts = await this.contactRepository.find({ where: whereClause });

    // In-memory search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      contacts = contacts.filter(
        c =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.number && c.number.toLowerCase().includes(q)) ||
          (c.pushName && c.pushName.toLowerCase().includes(q)),
      );
    }

    // In-memory sort
    const dir = order === 'DESC' ? -1 : 1;
    contacts.sort((a, b) => {
      switch (sortBy) {
        case 'name': {
          const aName = (a.name || a.pushName || '').toLowerCase();
          const bName = (b.name || b.pushName || '').toLowerCase();
          return aName < bName ? -dir : aName > bName ? dir : 0;
        }
        case 'number':
          return (a.number || '') < (b.number || '') ? -dir : (a.number || '') > (b.number || '') ? dir : 0;
        case 'recent':
          return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
        case 'lastSeen':
          return (b.lastSyncedAt?.getTime() || 0) - (a.lastSyncedAt?.getTime() || 0);
        default:
          return 0;
      }
    });

    // Pagination
    return contacts.slice(offset, offset + limit);
  }

  /**
   * Get a single contact by ID
   */
  async getContactById(sessionId: string, contactId: string): Promise<Contact | null> {
    return this.contactRepository.findOne({
      where: { sessionId, contactId },
    });
  }

  /**
   * Get contact by phone number
   */
  async getContactByNumber(sessionId: string, number: string): Promise<Contact | null> {
    return this.contactRepository.findOne({
      where: { sessionId, number },
    });
  }

  /**
   * Sync contacts from WhatsApp to database
   */
  async syncContacts(sessionId: string): Promise<{ synced: number; new: number; updated: number }> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started or not ready');
    }

    try {
      // Fetch contacts from WhatsApp
      this.logger.log(`Fetching contacts from WhatsApp for session ${sessionId}`);
      const whatsappContacts = await engine.getContacts();

      const existingContacts = await this.contactRepository.find({
        where: { sessionId },
      });

      const existingMap = new Map(existingContacts.map(c => [c.contactId, c]));

      let newCount = 0;
      let updatedCount = 0;
      const contactsToSave: Contact[] = [];

      for (const waContact of whatsappContacts) {
        const existing = existingMap.get(waContact.id);

        if (existing) {
          // Update existing contact
          let needsUpdate = false;

          if (waContact.name !== existing.name) {
            existing.name = waContact.name || null;
            needsUpdate = true;
          }
          if (waContact.pushName !== existing.pushName) {
            existing.pushName = waContact.pushName || null;
            needsUpdate = true;
          }
          if (waContact.isMyContact !== existing.isMyContact) {
            existing.isMyContact = waContact.isMyContact;
            needsUpdate = true;
          }
          if (waContact.isBlocked !== existing.isBlocked) {
            existing.isBlocked = waContact.isBlocked || false;
            needsUpdate = true;
          }
          if (waContact.profilePicUrl !== existing.profilePicUrl) {
            existing.profilePicUrl = waContact.profilePicUrl || null;
            needsUpdate = true;
          }

          if (needsUpdate) {
            existing.syncVersion = (existing.syncVersion || 0) + 1;
            existing.lastSyncedAt = new Date();
            contactsToSave.push(existing);
            updatedCount++;
          }
        } else {
          // Create new contact
          const newContact = this.contactRepository.create({
            sessionId,
            contactId: waContact.id,
            name: waContact.name || null,
            pushName: waContact.pushName || null,
            number: waContact.number,
            isMyContact: waContact.isMyContact,
            isBlocked: waContact.isBlocked || false,
            profilePicUrl: waContact.profilePicUrl || null,
            syncVersion: 1,
            lastSyncedAt: new Date(),
          });
          contactsToSave.push(newContact);
          newCount++;
        }
      }

      // Batch save all contacts - deduplicate to avoid unique constraint errors
      if (contactsToSave.length > 0) {
        // Remove duplicates by contactId (keep last occurrence as it's most recent)
        const uniqueContacts = new Map<string, Contact>();
        for (const contact of contactsToSave) {
          uniqueContacts.set(contact.contactId, contact);
        }
        await this.contactRepository.save(Array.from(uniqueContacts.values()));
      }

      this.logger.log(
        `Synced ${contactsToSave.length} contacts for session ${sessionId} (${newCount} new, ${updatedCount} updated)`,
      );

      return {
        synced: contactsToSave.length,
        new: newCount,
        updated: updatedCount,
      };
    } catch (error) {
      this.logger.error(`Failed to sync contacts for session ${sessionId}`, error);
      throw new BadRequestException(
        `Failed to sync contacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Sync a single contact from WhatsApp
   */
  async syncSingleContact(sessionId: string, contactId: string): Promise<Contact | null> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }

    try {
      const waContact = await engine.getContactById(contactId);
      if (!waContact) {
        return null;
      }

      const existing = await this.getContactById(sessionId, contactId);

      if (existing) {
        // Update existing
        existing.name = waContact.name || null;
        existing.pushName = waContact.pushName || null;
        existing.number = waContact.number;
        existing.isMyContact = waContact.isMyContact;
        existing.isBlocked = waContact.isBlocked || false;
        existing.profilePicUrl = waContact.profilePicUrl || null;
        existing.syncVersion = (existing.syncVersion || 0) + 1;
        existing.lastSyncedAt = new Date();
        return this.contactRepository.save(existing);
      } else {
        // Create new
        const newContact = this.contactRepository.create({
          sessionId,
          contactId: waContact.id,
          name: waContact.name || null,
          pushName: waContact.pushName || null,
          number: waContact.number,
          isMyContact: waContact.isMyContact,
          isBlocked: waContact.isBlocked || false,
          profilePicUrl: waContact.profilePicUrl || null,
          syncVersion: 1,
          lastSyncedAt: new Date(),
        });
        return this.contactRepository.save(newContact);
      }
    } catch (error) {
      this.logger.error(`Failed to sync contact ${contactId} for session ${sessionId}`, error);
      return null;
    }
  }

  /**
   * Update contact profile picture URL
   */
  async updateProfilePicture(sessionId: string, contactId: string, profilePicUrl: string): Promise<Contact | null> {
    const contact = await this.getContactById(sessionId, contactId);
    if (!contact) {
      return null;
    }

    contact.profilePicUrl = profilePicUrl;
    return this.contactRepository.save(contact);
  }

  /**
   * Delete all contacts for a session (cleanup)
   */
  async deleteContactsBySession(sessionId: string): Promise<number> {
    const result = await this.contactRepository.delete({ sessionId });
    return result.affected || 0;
  }

  /**
   * Get contact statistics for a session
   */
  async getContactStats(sessionId: string): Promise<{
    total: number;
    myContacts: number;
    blocked: number;
    withProfilePic: number;
    lastSynced: Date | null;
  }> {
    const [total, myContacts, blocked, withProfilePic] = await Promise.all([
      this.contactRepository.count({ where: { sessionId } }),
      this.contactRepository.count({ where: { sessionId, isMyContact: true } }),
      this.contactRepository.count({ where: { sessionId, isBlocked: true } }),
      this.contactRepository.count({ where: { sessionId, profilePicUrl: undefined } }),
    ]);

    const lastSyncedContact = await this.contactRepository.findOne({
      where: { sessionId },
      order: { lastSyncedAt: 'DESC' },
    });

    return {
      total,
      myContacts,
      blocked,
      withProfilePic,
      lastSynced: lastSyncedContact?.lastSyncedAt || null,
    };
  }

  /**
   * Search contacts across all sessions (admin only)
   */
  async searchAllContacts(searchQuery: string, limit = 100): Promise<Contact[]> {
    // Fetch all contacts and filter in-memory for MongoDB compatibility
    const allContacts = await this.contactRepository.find();
    const q = searchQuery.toLowerCase();
    const filtered = allContacts.filter(
      c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.number && c.number.toLowerCase().includes(q)) ||
        (c.pushName && c.pushName.toLowerCase().includes(q)),
    );
    filtered.sort((a, b) => {
      const aName = (a.name || a.pushName || '').toLowerCase();
      const bName = (b.name || b.pushName || '').toLowerCase();
      return aName < bName ? -1 : aName > bName ? 1 : 0;
    });
    return filtered.slice(0, limit);
  }
}
