import {
  Entity,
  Column,
  PrimaryColumn,
  BeforeInsert,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Chat Entity - Stores WhatsApp chats per session
 * @unique - sessionId + chatId combination must be unique to avoid conflicts between sessions
 */
@Entity('chats')
@Unique(['sessionId', 'chatId'])
@Index(['sessionId'])
@Index(['sessionId', 'isGroup'])
@Index(['sessionId', 'name'])
export class Chat {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  @Column({ type: 'varchar', length: 100 })
  sessionId: string;

  @Column({ type: 'varchar', length: 100 })
  chatId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'boolean', default: false })
  isGroup: boolean;

  @Column({ type: 'boolean', default: false })
  archived: boolean;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'bigint', nullable: true })
  timestamp: number | null;

  @Column({ type: 'int', default: 0 })
  unreadCount: number;

  @Column({ type: 'bigint', nullable: true })
  muteExpiration: number | null;

  @Column({ type: 'simple-json', nullable: true })
  lastMessage: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'bigint', default: 0 })
  messageCount: number;

  @Column({ type: 'bigint', default: 0 })
  syncVersion: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt: Date | null;
}
