const STORAGE_KEY = 'curitiba:last-attendance-pulse';
const EVENT_NAME = 'curitiba:attendance-recorded';

export interface AttendancePulse {
  worksiteId: string;
  at: number;
  count: number;
}

export function publishAttendancePulse(worksiteId: string, count: number) {
  const pulse: AttendancePulse = { worksiteId, count, at: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pulse));
  } catch {
    // O registro de ponto já foi concluído; falha de armazenamento visual não deve afetá-lo.
  }
  window.dispatchEvent(new CustomEvent<AttendancePulse>(EVENT_NAME, { detail: pulse }));
}

export function readAttendancePulse(): AttendancePulse | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<AttendancePulse> | null;
    if (!value || typeof value.worksiteId !== 'string' || typeof value.at !== 'number' || typeof value.count !== 'number') return null;
    return { worksiteId: value.worksiteId, at: value.at, count: value.count };
  } catch {
    return null;
  }
}

export function subscribeAttendancePulse(listener: (pulse: AttendancePulse) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<AttendancePulse>).detail);
  window.addEventListener(EVENT_NAME, handle);
  return () => window.removeEventListener(EVENT_NAME, handle);
}
