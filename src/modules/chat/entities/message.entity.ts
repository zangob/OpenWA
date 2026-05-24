import { Entity, Column, PrimaryColumn, ObjectIdColumn, BeforeInsert, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Message Entity - Stores WhatsApp messages as separate documents
 * Each message is a separate document with chatId reference
 * @unique - sessionId + chatId + messageId combination must be unique
 */
@Entity('messages')
@Unique(['sessionId', 'chatId', 'messageId'])
@Index(['sessionId'])
@Index(['sessionId', 'chatId'])
@Index(['sessionId', 'timestamp'])
@Index(['chatId'])
export class Message {
  @ObjectIdColumn()
  _id?: any;

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

  @Column({ type: 'varchar', length: 100 })
  messageId: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'bigint', nullable: true })
  timestamp: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  from: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  to: string | null;

  @Column({ type: 'boolean', default: false })
  fromMe: boolean;

  @Column({ type: 'boolean', default: false })
  hasMedia: boolean;

  @Column({ type: 'simple-json', nullable: true })
  mediaData: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  ack: number | null;

  @Column({ type: 'simple-json', nullable: true })
  quotedMessage: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
