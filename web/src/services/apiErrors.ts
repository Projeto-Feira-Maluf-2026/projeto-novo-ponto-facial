/**
 * Classifies failures from the API so each screen can say what actually went
 * wrong (expired session, missing permission, conflict, outage) instead of a
 * single "API offline" message for every case.
 */
export type ApiErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'rate_limited'
  | 'unavailable'
  | 'network'
  | 'misrouted'
  | 'unknown';

interface ServerErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { errors?: Array<{ message?: unknown }> };
  };
}

// Pydantic prefixes messages raised by our own validators (written in Portuguese
// for the operator) with "Value error, ". Built-in English messages are not shown.
const CUSTOM_VALIDATION_PREFIX = 'Value error, ';

function firstCustomValidationMessage(body: ServerErrorBody): string | null {
  const errors = body.error?.details?.errors;
  if (!Array.isArray(errors)) return null;
  for (const item of errors) {
    if (typeof item?.message === 'string' && item.message.startsWith(CUSTOM_VALIDATION_PREFIX)) {
      return `${item.message.slice(CUSTOM_VALIDATION_PREFIX.length)}.`;
    }
  }
  return null;
}

interface AxiosLikeError {
  code?: string;
  message?: string;
  response?: { status?: number; data?: unknown };
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string | null;
  /** Message written by the API for domain errors (409/422). Safe to show. */
  readonly serverMessage: string | null;

  constructor(kind: ApiErrorKind, status: number, code: string | null, serverMessage: string | null) {
    super(serverMessage || kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 413 || status === 422) return 'invalid';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

function serverError(data: unknown): { code: string | null; message: string | null } {
  const body = (data && typeof data === 'object' ? data : {}) as ServerErrorBody;
  const code = typeof body.error?.code === 'string' ? body.error.code : null;
  const message = firstCustomValidationMessage(body)
    ?? (typeof body.error?.message === 'string' ? body.error.message : null);
  return { code, message };
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const candidate = (error ?? {}) as AxiosLikeError;
  if (candidate.message === 'API_ROUTE_RETURNED_HTML') {
    return new ApiError('misrouted', 0, null, null);
  }
  const status = Number(candidate.response?.status || 0);
  if (!status) {
    const offline = ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(String(candidate.code));
    return new ApiError(offline ? 'network' : 'unknown', 0, null, null);
  }
  const { code, message } = serverError(candidate.response?.data);
  const kind = kindForStatus(status);
  // Only domain errors carry user-facing text; 5xx bodies are never echoed.
  const safeMessage = kind === 'conflict' || kind === 'invalid' || kind === 'not_found' ? message : null;
  return new ApiError(kind, status, code, safeMessage);
}

const messagesByCode: Record<string, string> = {
  EMPLOYEE_REGISTRATION_CONFLICT: 'Já existe um funcionário com esta matrícula.',
  WORKSITE_CODE_CONFLICT: 'Já existe uma obra com este código.',
  DEVICE_SERIAL_CONFLICT: 'Já existe um dispositivo com este número de série.',
  WORKSITE_NOT_FOUND: 'A obra selecionada não existe mais ou está fora do seu acesso. Atualize a página.',
};

/**
 * Plain-language message for a failed action. `action` completes the sentence
 * "Seu perfil não tem permissão para …", e.g. "listar as obras".
 */
export function describeApiError(error: unknown, action: string): string {
  const apiError = toApiError(error);
  switch (apiError.kind) {
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente para continuar.';
    case 'forbidden':
      return `Seu perfil não tem permissão para ${action}. Peça acesso a um administrador.`;
    case 'conflict':
    case 'invalid':
    case 'not_found':
      return (apiError.code && messagesByCode[apiError.code])
        || apiError.serverMessage
        || `Não foi possível ${action}. Revise os dados informados.`;
    case 'rate_limited':
      return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
    case 'network':
      return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
    case 'misrouted':
      return 'O endereço da API respondeu com o site em vez de dados. Verifique VITE_API_URL e as rotas do deploy.';
    case 'unavailable':
      return `O serviço não conseguiu ${action} agora. Tente novamente em instantes.`;
    default:
      return `Não foi possível ${action}. Tente novamente.`;
  }
}
