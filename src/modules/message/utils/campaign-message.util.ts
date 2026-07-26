// Sends a single composed campaign message to one recipient, applying
// per-recipient template substitution. Shared by the test send (CampaignService)
// and the per-tick send (CampaignProcessor) so the behaviour is identical.

import * as fs from 'fs';
import * as path from 'path';
import { IWhatsAppEngine, MessageResult } from '../../../engine/interfaces/whatsapp-engine.interface';
import { applyTemplateVars } from './phone.util';

export interface CampaignTemplate {
  type: 'text' | 'image';
  text?: string;
  image?: { base64?: string; url?: string; mimetype?: string };
}

interface ParsedMedia {
  data: string;
  mimetype: string;
}

/** Default local storage path used by StorageService. */
const LOCAL_MEDIA_PATH = process.env.STORAGE_PATH || './data/media';

/**
 * Resolve the media payload for an image template into the `{ data, mimetype }`
 * shape the engine expects. Handles raw base64, `data:` URIs, http(s) URLs,
 * and local file paths (e.g. `/api/infra/media/...`).
 */
function resolveImage(image: NonNullable<CampaignTemplate['image']>): ParsedMedia {
  const url = image.url?.trim();
  if (url) {
    // HTTP(S) URLs can be used directly — the engine fetches them.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return { data: url, mimetype: image.mimetype || 'image/jpeg' };
    }

    // Local path — read the file from storage and return as base64.
    const localPath = url.startsWith('/') ? url.slice(1) : url;
    // Strip leading "api/infra/media/" if the frontend sent the API route.
    const relativePath = localPath.replace(/^api\/infra\/media\//, 'uploads/');
    const fullPath = path.resolve(LOCAL_MEDIA_PATH, relativePath);
    if (fs.existsSync(fullPath)) {
      const buf = fs.readFileSync(fullPath);
      return { data: buf.toString('base64'), mimetype: image.mimetype || 'image/jpeg' };
    }
    // Fall through — if file doesn't exist, return the URL as-is and let the
    // engine try (it will likely fail, but the error will be clear).
    return { data: url, mimetype: image.mimetype || 'image/jpeg' };
  }

  const raw = (image.base64 || '').trim();
  // Strip a data-URI prefix ("data:image/png;base64,....") — the engine treats
  // the string as raw base64, so the prefix must be removed and the mimetype
  // extracted from it when present.
  const dataUriMatch = /^data:([^;]+);base64,(.*)$/s.exec(raw);
  if (dataUriMatch) {
    return { data: dataUriMatch[2], mimetype: image.mimetype || dataUriMatch[1] };
  }
  return { data: raw, mimetype: image.mimetype || 'image/jpeg' };
}

/**
 * Send one message built from `template` to `chatId`, substituting `{name}`
 * (and any other var) from `vars`.
 */
export async function sendCampaignMessage(
  engine: IWhatsAppEngine,
  template: CampaignTemplate,
  chatId: string,
  vars: Record<string, string>,
): Promise<MessageResult> {
  const text = template.text ? applyTemplateVars(template.text, vars) : '';

  if (template.type === 'image' && template.image) {
    const media = resolveImage(template.image);
    if (!media.data) {
      throw new Error('Image template has no image data');
    }
    return engine.sendImageMessage(chatId, {
      mimetype: media.mimetype,
      data: media.data,
      caption: text || undefined,
    });
  }

  if (!text) {
    throw new Error('Text template has no text');
  }
  return engine.sendTextMessage(chatId, text);
}
