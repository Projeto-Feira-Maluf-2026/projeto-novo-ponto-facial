import type { FaceBox } from '../components/CameraCapture';

// Memória curta dos rostos que o terminal já tratou. Cada rosto é seguido de
// quadro em quadro pela sobreposição da caixa, então quem já foi registrado
// não volta ao servidor enquanto se mexe diante da câmera, e quem falha (por
// exemplo, alguém sem cadastro) espera um pouco antes de nova tentativa, sem
// atrasar quem acabou de chegar.

export type FaceMemoryEntry = {
  box: FaceBox;
  state: 'done' | 'failing';
  failures: number;
  retryAt: number;
  lastSeenAt: number;
};

// Um rosto some do detector por alguns quadros quando vira a cabeça. Até este
// tempo ele continua "lembrado"; depois disso, a pessoa saiu do quadro.
export const FACE_MEMORY_TTL_MS = 900;
const SAME_FACE_MIN_IOU = 0.2;

export function faceBoxIou(left: FaceBox, right: FaceBox) {
  const intersectionLeft = Math.max(left.x, right.x);
  const intersectionTop = Math.max(left.y, right.y);
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, intersectionRight - intersectionLeft)
    * Math.max(0, intersectionBottom - intersectionTop);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Espera antes de reenviar um rosto que já falhou `failures` vezes. */
export function faceRetryDelay(failures: number) {
  if (failures <= 3) return 150;
  if (failures <= 5) return 600;
  return 1_500;
}

function matchingEntry(memory: FaceMemoryEntry[], box: FaceBox) {
  let best: FaceMemoryEntry | undefined;
  let bestIou = SAME_FACE_MIN_IOU;
  for (const entry of memory) {
    const iou = faceBoxIou(entry.box, box);
    if (iou >= bestIou) {
      best = entry;
      bestIou = iou;
    }
  }
  return best;
}

/** Acompanha o movimento dos rostos visíveis e esquece quem saiu do quadro. */
export function refreshFaceMemory(memory: FaceMemoryEntry[], visible: FaceBox[], now: number) {
  const claimed = new Set<FaceMemoryEntry>();
  for (const box of visible) {
    const entry = matchingEntry(memory.filter((item) => !claimed.has(item)), box);
    if (!entry) continue;
    claimed.add(entry);
    entry.box = box;
    entry.lastSeenAt = now;
  }
  return memory.filter((entry) => now - entry.lastSeenAt <= FACE_MEMORY_TTL_MS);
}

/** Um rosto precisa ir ao servidor: é novo ou já pode ser tentado de novo. */
export function faceNeedsRecognition(memory: FaceMemoryEntry[], box: FaceBox, now: number) {
  const entry = matchingEntry(memory, box);
  if (!entry) return true;
  return entry.state === 'failing' && entry.retryAt <= now;
}

export function rememberFaceOutcome(
  memory: FaceMemoryEntry[],
  box: FaceBox,
  outcome: 'done' | 'failed',
  now: number,
) {
  const entry = matchingEntry(memory, box);
  if (outcome === 'done') {
    const rest = memory.filter((item) => item !== entry);
    return [...rest, { box, state: 'done' as const, failures: 0, retryAt: 0, lastSeenAt: now }];
  }
  if (entry?.state === 'done') return memory;
  const failures = (entry?.failures ?? 0) + 1;
  const rest = memory.filter((item) => item !== entry);
  return [
    ...rest,
    { box, state: 'failing' as const, failures, retryAt: now + faceRetryDelay(failures), lastSeenAt: now },
  ];
}

export function countDoneFaces(memory: FaceMemoryEntry[]) {
  return memory.filter((entry) => entry.state === 'done').length;
}
