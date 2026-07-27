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
 * Contact Entity - Stores WhatsApp contacts per session
 * @unique - sessionId + contactId combination must be unique to avoid conflicts between sessions
 */
@Entity('contacts')
@Unique(['sessionId', 'contactId'])
@Index(['sessionId'])
@Index(['sessionId', 'isMyContact'])
@Index(['sessionId', 'name'])
export class Contact {
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
  contactId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pushName: string | null;

  @Column({ type: 'varchar', length: 50 })
  number: string;

  @Column({ type: 'boolean', default: false })
  isMyContact: boolean;

  @Column({ type: 'boolean', default: false })
  isBlocked: boolean;

  @Column({ type: 'text', nullable: true })
  profilePicUrl: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  status: string | null;

  @Column({ type: 'bigint', nullable: true })
  lastSeenAt: number | null;

  @Column({ type: 'simple-json', nullable: true })
  labels: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'bigint', default: 0 })
  syncVersion: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt: Date | null;
}
