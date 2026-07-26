import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the bulk-campaign fields to `message_batches`.
 *
 * Only PostgreSQL relies on migrations (it runs with `synchronize: false`).
 * SQLite and MongoDB run with `synchronize: true`, so the new entity columns
 * are created automatically there and this migration is a no-op for them.
 *
 * The Postgres branch is fully idempotent: it creates the table if it does not
 * yet exist and adds each campaign column only if missing.
 */
export class AddCampaignFields1783000000000 implements MigrationInterface {
  name = 'AddCampaignFields1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return; // SQLite / MongoDB use synchronize
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_batches" (
        "id" uuid PRIMARY KEY,
        "batch_id" varchar NOT NULL,
        "session_id" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'pending',
        "messages" jsonb,
        "options" jsonb,
        "progress" jsonb,
        "results" jsonb,
        "current_index" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "started_at" TIMESTAMP,
        "completed_at" TIMESTAMP,
        CONSTRAINT "UQ_message_batches_batch_id" UNIQUE ("batch_id")
      )
    `);

    const columns: Array<[string, string]> = [
      ['kind', `varchar NOT NULL DEFAULT 'bulk'`],
      ['name', 'varchar'],
      ['messageTemplate', 'jsonb'],
      ['recipients', 'jsonb'],
      ['test_chat_id', 'varchar'],
      ['test_message_id', 'varchar'],
      ['test_sent_at', 'TIMESTAMP'],
    ];

    for (const [col, def] of columns) {
      await queryRunner.query(`ALTER TABLE "message_batches" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      return;
    }
    const columns = [
      'kind',
      'name',
      'messageTemplate',
      'recipients',
      'test_chat_id',
      'test_message_id',
      'test_sent_at',
    ];
    for (const col of columns) {
      await queryRunner.query(`ALTER TABLE "message_batches" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
