import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Send,
  Pause,
  Play,
  Ban,
  Image as ImageIcon,
  Type as TypeIcon,
} from 'lucide-react';
import {
  campaignApi,
  mediaApi,
  type Campaign,
  type CreateCampaignPayload,
} from '../services/api';
import { useSessionsQuery, useSessionGroupsQuery } from '../hooks/queries';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import './Campaigns.css';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

interface ParsedNumber {
  name: string;
  phone: string;
}

const ACTIVE_STATUSES = ['processing', 'paused'];

function parseNumbersJson(raw: string): { numbers: ParsedNumber[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { numbers: [], error: null };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { numbers: [], error: 'Invalid JSON syntax' };
  }
  if (!Array.isArray(data)) {
    return { numbers: [], error: 'JSON must be an array of { name, phone }' };
  }
  const numbers: ParsedNumber[] = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      return { numbers: [], error: `Item ${i + 1} is not an object` };
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      return { numbers: [], error: `Item ${i + 1} is missing a "name"` };
    }
    if (typeof item.phone !== 'string' && typeof item.phone !== 'number') {
      return { numbers: [], error: `Item ${i + 1} is missing a "phone"` };
    }
    numbers.push({ name: String(item.name).trim(), phone: String(item.phone).trim() });
  }
  return { numbers, error: null };
}

export function Campaigns() {
  useDocumentTitle('Campaigns');
  const { canWrite } = useRole();
  const toast = useToast();

  const { data: allSessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const readySessions = useMemo(() => allSessions.filter(s => s.status === 'ready'), [allSessions]);

  const [step, setStep] = useState<Step>(1);
  const [sessionId, setSessionId] = useState('');

  // Compose
  const [name, setName] = useState('');
  const [msgType, setMsgType] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageMime, setImageMime] = useState('');
  const [uploading, setUploading] = useState(false);

  // Recipients
  const [numbersJson, setNumbersJson] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [countryCode, setCountryCode] = useState('');

  // Draft / test / launch
  const [batchId, setBatchId] = useState('');
  const [createResult, setCreateResult] = useState<{ valid: number; invalid: { input: string; reason: string }[] } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(60);
  const [busy, setBusy] = useState(false);

  const { data: groups = [], isLoading: loadingGroups } = useSessionGroupsQuery(sessionId, step === 2 && !!sessionId);

  useEffect(() => {
    if (readySessions.length > 0 && !sessionId) {
      setSessionId(readySessions[0].id);
    }
  }, [readySessions, sessionId]);

  const parsed = useMemo(() => parseNumbersJson(numbersJson), [numbersJson]);
  const recipientCount = parsed.numbers.length + selectedGroups.length;

  // Live tracking — poll while the campaign is active.
  const { data: tracked } = useQuery({
    queryKey: ['campaign', sessionId, batchId],
    queryFn: () => campaignApi.get(sessionId, batchId),
    enabled: step === 6 && !!sessionId && !!batchId,
    refetchInterval: query => {
      const status = (query.state.data as Campaign | undefined)?.status;
      return status && ACTIVE_STATUSES.includes(status) ? 2500 : false;
    },
  });

  const handleImageFile = (file: File) => {
    setImageFile(file);
    setImageMime(file.type);
    setImageUrl('');
  };

  const composeValid =
    !!sessionId && (msgType === 'text' ? text.trim().length > 0 : (!!imageFile || imageUrl.length > 0));

  // ── Actions ────────────────────────────────────────────────────────────────

  const createDraft = async () => {
    setBusy(true);
    try {
      let finalImageUrl = imageUrl;
      if (msgType === 'image' && imageFile && !imageUrl) {
        setUploading(true);
        try {
          const uploaded = await mediaApi.upload(imageFile);
          finalImageUrl = uploaded.url;
          setImageUrl(uploaded.url);
        } finally {
          setUploading(false);
        }
      }
      const payload: CreateCampaignPayload = {
        name: name || undefined,
        message: msgType === 'image'
          ? { type: 'image', text: text || undefined, image: { url: finalImageUrl || undefined, mimetype: imageMime || undefined } }
          : { type: 'text', text },
        recipients: {
          numbers: parsed.numbers.length ? parsed.numbers : undefined,
          groups: selectedGroups.length ? selectedGroups : undefined,
        },
        defaultCountryCode: countryCode || undefined,
      };
      const res = await campaignApi.create(sessionId, payload);
      setBatchId(res.batchId);
      setCreateResult({ valid: res.validRecipients, invalid: res.invalid });
      setStep(4);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) return;
    setBusy(true);
    try {
      await campaignApi.test(sessionId, batchId, testPhone.trim());
      toast.success('Test message sent — check your WhatsApp');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    setBusy(true);
    try {
      await campaignApi.start(sessionId, batchId, delaySeconds, true);
      toast.success('Campaign started');
      setStep(6);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start campaign');
    } finally {
      setBusy(false);
    }
  };

  const controlCampaign = async (action: 'pause' | 'resume' | 'cancel') => {
    setBusy(true);
    try {
      await campaignApi[action](sessionId, batchId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const resetWizard = () => {
    setStep(1);
    setName('');
    setText('');
    setImageUrl('');
    setImageFile(null);
    setImageMime('');
    setNumbersJson('');
    setSelectedGroups([]);
    setCountryCode('');
    setBatchId('');
    setCreateResult(null);
    setTestPhone('');
    setDelaySeconds(60);
  };

  if (loadingSessions) {
    return (
      <div className="campaigns" style={{ display: 'flex', justifyContent: 'center', minHeight: 300 }}>
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Compose' },
    { n: 2, label: 'Recipients' },
    { n: 3, label: 'Review' },
    { n: 4, label: 'Test' },
    { n: 5, label: 'Launch' },
    { n: 6, label: 'Track' },
  ];

  return (
    <div className="campaigns">
      <PageHeader title="Bulk Campaigns" subtitle="Send a message to many numbers & groups, one at a time." />

      {readySessions.length === 0 && (
        <div className="campaign-warn">No ready sessions. Start a WhatsApp session first.</div>
      )}

      <div className="stepper">
        {steps.map(s => (
          <div key={s.n} className={`step ${step === s.n ? 'active' : ''} ${step > s.n ? 'done' : ''}`}>
            <span className="step-num">{step > s.n ? <CheckCircle size={16} /> : s.n}</span>
            <span className="step-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step 1: Compose */}
      {step === 1 && (
        <div className="card">
          <h2>1. Compose message</h2>
          <div className="form-group">
            <label>Session</label>
            <select value={sessionId} onChange={e => setSessionId(e.target.value)}>
              {readySessions.length === 0 && <option value="">No ready sessions</option>}
              {readySessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.phone || 'no number'})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Campaign name (optional)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="July promo" />
          </div>
          <div className="form-group">
            <label>Message type</label>
            <div className="toggle-group">
              <button className={msgType === 'text' ? 'active' : ''} onClick={() => setMsgType('text')}>
                <TypeIcon size={15} /> Text
              </button>
              <button className={msgType === 'image' ? 'active' : ''} onClick={() => setMsgType('image')}>
                <ImageIcon size={15} /> Image
              </button>
            </div>
          </div>
          {msgType === 'image' && (
            <div className="form-group">
              <label>Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={e => e.target.files?.[0] && handleImageFile(e.target.files[0])}
              />
            </div>
          )}
          <div className="form-group">
            <label>{msgType === 'image' ? 'Caption' : 'Text'} — use {'{name}'} to personalize</label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={4}
              placeholder={'Hi {name}, we have a special offer for you!'}
            />
          </div>

          <div className="preview">
            <div className="preview-label">Preview</div>
            <div className="bubble">
              {imageFile && !imageUrl && <img src={URL.createObjectURL(imageFile)} alt="preview" />}
              {imageUrl && <img src={imageUrl} alt="preview" />}
              <span>{text || <em>Your message…</em>}</span>
            </div>
          </div>

          <div className="actions">
            <button className="btn-primary" disabled={!composeValid} onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Recipients */}
      {step === 2 && (
        <div className="card">
          <h2>2. Recipients</h2>
          <div className="form-group">
            <label>Phone numbers (JSON: array of {'{ name, phone }'})</label>
            <textarea
              className={`mono ${parsed.error ? 'invalid' : numbersJson.trim() ? 'valid' : ''}`}
              value={numbersJson}
              onChange={e => setNumbersJson(e.target.value)}
              rows={8}
              placeholder={'[\n  { "name": "John", "phone": "+628123456789" },\n  { "name": "Jane", "phone": "+628987654321" }\n]'}
            />
            {parsed.error ? (
              <span className="hint error">
                <XCircle size={13} /> {parsed.error}
              </span>
            ) : (
              <span className="hint ok">
                <CheckCircle size={13} /> {parsed.numbers.length} valid number(s)
              </span>
            )}
          </div>

          <div className="form-group">
            <label>Default country code (optional, prepended to local numbers)</label>
            <input value={countryCode} onChange={e => setCountryCode(e.target.value)} placeholder="+62" />
          </div>

          <div className="form-group">
            <label>Groups</label>
            {loadingGroups ? (
              <span className="hint">Loading groups…</span>
            ) : groups.length === 0 ? (
              <span className="hint">No groups found for this session.</span>
            ) : (
              <div className="group-list">
                {groups.map(g => (
                  <label key={g.id} className="group-item">
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g.id)}
                      onChange={e =>
                        setSelectedGroups(prev =>
                          e.target.checked ? [...prev, g.id] : prev.filter(x => x !== g.id),
                        )
                      }
                    />
                    <span>{g.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="actions">
            <button className="btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="btn-primary"
              disabled={!!parsed.error || recipientCount === 0}
              onClick={() => setStep(3)}
            >
              Next ({recipientCount} recipients)
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="card">
          <h2>3. Review</h2>
          <ul className="review">
            <li>
              <span>Message type</span>
              <b>{msgType}</b>
            </li>
            <li>
              <span>Phone recipients</span>
              <b>{parsed.numbers.length}</b>
            </li>
            <li>
              <span>Group recipients</span>
              <b>{selectedGroups.length}</b>
            </li>
            <li>
              <span>Total</span>
              <b>{recipientCount}</b>
            </li>
          </ul>
          <div className="actions">
            <button className="btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn-primary" disabled={busy || !canWrite} onClick={createDraft}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : null} {uploading ? 'Uploading image…' : 'Create & validate'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Test */}
      {step === 4 && (
        <div className="card">
          <h2>4. Send a test</h2>
          {createResult && (
            <div className="validate-result">
              <span className="ok">
                <CheckCircle size={14} /> {createResult.valid} valid recipients
              </span>
              {createResult.invalid.length > 0 && (
                <details>
                  <summary className="error">{createResult.invalid.length} invalid (ignored)</summary>
                  <ul>
                    {createResult.invalid.map((iv, idx) => (
                      <li key={idx}>
                        {iv.input} — {iv.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <p className="muted">Send one test message to your own number and confirm it looks right before launching.</p>
          <div className="form-group">
            <label>Your phone number</label>
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+628123456789" />
          </div>
          <div className="actions">
            <button className="btn-ghost" onClick={() => setStep(3)}>
              Back
            </button>
            <button className="btn-secondary" disabled={busy || !testPhone.trim()} onClick={sendTest}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send test
            </button>
            <button className="btn-primary" onClick={() => setStep(5)}>
              Test looks good →
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Launch */}
      {step === 5 && (
        <div className="card">
          <h2>5. Delay & launch</h2>
          <p className="muted">
            Messages are sent one-by-one. A longer delay is safer against WhatsApp bans. Minimum 30 seconds.
          </p>
          <div className="form-group">
            <label>Delay between messages: {delaySeconds}s</label>
            <input
              type="range"
              min={30}
              max={300}
              step={5}
              value={delaySeconds}
              onChange={e => setDelaySeconds(Number(e.target.value))}
            />
            <span className="hint">
              Estimated duration for {createResult?.valid ?? recipientCount} messages: ~
              {Math.round(((createResult?.valid ?? recipientCount) * delaySeconds) / 60)} min
            </span>
          </div>
          <div className="actions">
            <button className="btn-ghost" onClick={() => setStep(4)}>
              Back
            </button>
            <button className="btn-primary" disabled={busy || !canWrite} onClick={launch}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />} Start campaign
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Track */}
      {step === 6 && (
        <div className="card">
          <h2>6. Tracking</h2>
          {!tracked ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
              <Loader2 className="animate-spin" size={24} />
            </div>
          ) : (
            <TrackView campaign={tracked} busy={busy} onControl={controlCampaign} onNew={resetWizard} />
          )}
        </div>
      )}
    </div>
  );
}

function TrackView({
  campaign,
  busy,
  onControl,
  onNew,
}: {
  campaign: Campaign;
  busy: boolean;
  onControl: (a: 'pause' | 'resume' | 'cancel') => void;
  onNew: () => void;
}) {
  const p = campaign.progress;
  const done = p.sent + p.failed + p.cancelled;
  const pct = p.total > 0 ? Math.round((done / p.total) * 100) : 0;
  const isActive = ACTIVE_STATUSES.includes(campaign.status);
  const isFinished = ['completed', 'cancelled', 'failed'].includes(campaign.status);

  return (
    <>
      <div className={`status-badge status-${campaign.status}`}>{campaign.status}</div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-stats">
        <span>{pct}%</span>
        <span className="ok">{p.sent} sent</span>
        <span className="error">{p.failed} failed</span>
        <span>{p.pending} pending</span>
        <span>{p.total} total</span>
      </div>

      <div className="track-actions">
        {campaign.status === 'processing' && (
          <button className="btn-secondary" disabled={busy} onClick={() => onControl('pause')}>
            <Pause size={15} /> Pause
          </button>
        )}
        {campaign.status === 'paused' && (
          <button className="btn-primary" disabled={busy} onClick={() => onControl('resume')}>
            <Play size={15} /> Resume
          </button>
        )}
        {isActive && (
          <button className="btn-danger" disabled={busy} onClick={() => onControl('cancel')}>
            <Ban size={15} /> Cancel
          </button>
        )}
        {isFinished && (
          <button className="btn-primary" onClick={onNew}>
            New campaign
          </button>
        )}
      </div>

      {campaign.results && campaign.results.length > 0 && (
        <div className="results">
          <h3>Recent results</h3>
          <ul>
            {campaign.results.slice(-30).reverse().map((r, idx) => (
              <li key={idx}>
                {r.status === 'sent' ? (
                  <CheckCircle size={14} className="ok" />
                ) : (
                  <XCircle size={14} className="error" />
                )}
                <span className="mono">{r.chatId}</span>
                {r.error && <span className="err-msg">{r.error.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default Campaigns;
