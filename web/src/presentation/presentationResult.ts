import type { PunchType } from '../types/domain';

/**
 * sent: o backend recebeu sucesso do SMTP.
 * queued: o ponto foi salvo e a confirmação sai logo depois, em segundo plano.
 * none: não há e-mail para esta pessoa ou o envio está desativado.
 */
export type PresentationEmailStatus = 'sent' | 'queued' | 'none';

export interface PresentationParticipantResult {
  id: string;
  name: string;
  registration?: string | null;
  punchType?: PunchType | null;
  occurredAt: Date;
  email: PresentationEmailStatus;
}

export interface PresentationResult {
  worksiteName: string;
  worksiteCode?: string | null;
  participants: PresentationParticipantResult[];
}

export function shouldOfferPresentationResult(active: boolean, participants: PresentationParticipantResult[]) {
  return active && participants.length > 0;
}

export function firstName(name: string) {
  const [first] = name.trim().split(/\s+/);
  return first || name;
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}
