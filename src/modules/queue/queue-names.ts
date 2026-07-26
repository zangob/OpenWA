// Queue names used across the application
// Extracted to separate file to avoid circular dependency with processors
export const QUEUE_NAMES = {
  MESSAGE: 'message-queue',
  WEBHOOK: 'webhook-queue',
  CAMPAIGN: 'campaign-queue',
} as const;

// Payload for a single campaign "tick" — send the message at `index`, then
// self-chain the next tick. Kept here to avoid a processor↔service import cycle.
export interface CampaignJobData {
  batchId: string; // MessageBatch.batchId
  index: number; // recipient index this tick should send
}
