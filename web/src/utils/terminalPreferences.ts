const TERMINAL_WORKSITE_STORAGE_KEY = 'curitiba-terminal-worksite-id';

export function readTerminalWorksiteId() {
  try {
    return window.localStorage.getItem(TERMINAL_WORKSITE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveTerminalWorksiteId(worksiteId: string) {
  try {
    if (worksiteId) window.localStorage.setItem(TERMINAL_WORKSITE_STORAGE_KEY, worksiteId);
    else window.localStorage.removeItem(TERMINAL_WORKSITE_STORAGE_KEY);
  } catch {
    // O terminal continua funcional quando o navegador bloqueia armazenamento.
  }
}
