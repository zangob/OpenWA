import {
  Entity,
  PrimaryColumn,
  BeforeInsert,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { jsonColumnType, dateColumnType } from '../../../common/utils/column-types';

export enum BatchStatus {
  DRAFT = 'draft', // Campaign created but recipients not yet confirmed / test not sent
  TEST_SENT = 'test_sent', // Test message delivered, awaiting user confirmation to launch
  PENDING = 'pending',
  PROCESSING = 'processing',
  PAUSED = 'paused', // Campaign temporarily halted by the user, resumable
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export enum BatchMessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface BatchMessageResult {
  chatId: string;
  status: BatchMessageStatus;
  messageId?: string;
  error?: {
    code: string;
    message: string;
  };
  sentAt?: Date;
}

export interface BatchProgress {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  cancelled: number;
}

@Entity('message_batches')
export class MessageBatch {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  @Column({ name: 'batch_id', unique: true })
  batchId: string;

  @Column({ name: 'session_id' })
  sessionId: string;

  // ── Campaign fields (nullable; only populated for the wizard-driven flow) ──

  /** Distinguishes the wizard "campaign" flow from the legacy "bulk" flow. */
  @Column({ type: 'varchar', default: 'bulk' })
  kind: 'bulk' | 'campaign';

  /** Human-friendly campaign name. */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  /**
   * Single composed message applied to every recipient. Text + optional image.
   * `{name}` placeholders are substituted per-recipient at send time.
   */
  @Column({ type: jsonColumnType(), nullable: true })
  messageTemplate: {
    type: 'text' | 'image';
    text?: string;
    image?: { base64?: string; url?: string; mimetype?: string };
  } | null;

  /** Resolved recipient list (numbers + groups) with display names. */
  @Column({ type: jsonColumnType(), nullable: true })
  recipients: Array<{ chatId: string; name: string; type: 'number' | 'group' }> | null;

  /** Chat id of the test recipient (the operator's own number). */
  @Column({ name: 'test_chat_id', type: 'varchar', nullable: true })
  testChatId: string | null;

  /** WhatsApp message id returned by the test send. */
  @Column({ name: 'test_message_id', type: 'varchar', nullable: true })
  testMessageId: string | null;

  @Column({ name: 'test_sent_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  testSentAt: Date | null;

  @Column({ type: 'varchar', default: BatchStatus.PENDING })
  status: BatchStatus;

  @Column({ type: jsonColumnType() })
  messages: Array<{
    chatId: string;
    type: string;
    content: Record<string, unknown>;
    variables?: Record<string, string>;
  }>;

  @Column({ type: jsonColumnType(), nullable: true })
  options: {
    delayBetweenMessages: number;
    randomizeDelay: boolean;
    stopOnError: boolean;
    defaultCountryCode?: string;
  };

  @Column({ type: jsonColumnType(), nullable: true })
  progress: BatchProgress;

  @Column({ type: jsonColumnType(), nullable: true })
  results: BatchMessageResult[];

  @Column({ name: 'current_index', default: 0 })
  currentIndex: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'started_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  completedAt: Date | null;
}
