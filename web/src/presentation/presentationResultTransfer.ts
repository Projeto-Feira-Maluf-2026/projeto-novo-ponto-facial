import type { PresentationResult } from './presentationResult';

const CHANNEL_PREFIX = 'curitiba:presentation-result:';
const TRANSFER_TIMEOUT_MS = 60_000;

interface SerializedPresentationResult extends Omit<PresentationResult, 'participants'> {
  participants: Array<Omit<PresentationResult['participants'][number], 'occurredAt'> & {
    occurredAt: string;
  }>;
}

type TransferMessage =
  | { type: 'ready'; sessionId: string }
  | { type: 'result'; sessionId: string; result: SerializedPresentationResult };

function serializeResult(result: PresentationResult): SerializedPresentationResult {
  return {
    ...result,
    participants: result.participants.map((participant) => ({
      ...participant,
      occurredAt: participant.occurredAt.toISOString(),
    })),
  };
}

function deserializeResult(result: SerializedPresentationResult): PresentationResult | null {
  if (!result || typeof result.worksiteName !== 'string' || !Array.isArray(result.participants)) return null;
  const participants = result.participants.map((participant) => ({
    ...participant,
    occurredAt: new Date(participant.occurredAt),
  }));
  if (!participants.length || participants.some((participant) => (
    typeof participant.id !== 'string'
    || typeof participant.name !== 'string'
    || Number.isNaN(participant.occurredAt.getTime())
  ))) return null;
  return { ...result, participants };
}

function randomSessionId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function openPresentationResultPage(result: PresentationResult) {
  if (typeof BroadcastChannel === 'undefined') return false;

  const sessionId = randomSessionId();
  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${sessionId}`);
  const cleanupTimer = window.setTimeout(() => channel.close(), TRANSFER_TIMEOUT_MS);
  channel.onmessage = (event: MessageEvent<TransferMessage>) => {
    if (event.data?.type !== 'ready' || event.data.sessionId !== sessionId) return;
    channel.postMessage({
      type: 'result',
      sessionId,
      result: serializeResult(result),
    } satisfies TransferMessage);
    window.clearTimeout(cleanupTimer);
    window.setTimeout(() => channel.close(), 250);
  };

  const summaryUrl = new URL('/apresentacao/resumo', window.location.origin);
  summaryUrl.searchParams.set('session', sessionId);
  const opened = window.open(summaryUrl, '_blank');
  if (!opened) {
    window.clearTimeout(cleanupTimer);
    channel.close();
    return false;
  }
  return true;
}

export function receivePresentationResult(
  sessionId: string,
  onResult: (result: PresentationResult) => void,
) {
  if (!sessionId || typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${sessionId}`);
  channel.onmessage = (event: MessageEvent<TransferMessage>) => {
    if (event.data?.type !== 'result' || event.data.sessionId !== sessionId) return;
    const result = deserializeResult(event.data.result);
    if (!result) return;
    onResult(result);
    channel.close();
  };
  channel.postMessage({ type: 'ready', sessionId } satisfies TransferMessage);
  return () => channel.close();
}
