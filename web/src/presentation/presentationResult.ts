import type { PunchType } from '../types/domain';

export interface PresentationParticipantResult {
  id: string;
  name: string;
  registration?: string | null;
  punchType?: PunchType | null;
  occurredAt: Date;
  emailSent: boolean;
}

export interface PresentationResult {
  worksiteName: string;
  worksiteCode?: string | null;
  participants: PresentationParticipantResult[];
}

export function shouldOfferPresentationResult(active: boolean, participants: PresentationParticipantResult[]) {
  return active && participants.length > 0;
}
