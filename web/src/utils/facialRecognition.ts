export type TemporalEvidence = {
  employeeId: string;
  image: string;
  capturedAt: number;
};

export function appendRecognitionEvidence(
  current: TemporalEvidence[],
  next: TemporalEvidence,
  temporalWindowMs: number,
  maxReadings: number,
) {
  return [
    ...current.filter((item) => (
      item.employeeId === next.employeeId
      && next.capturedAt - item.capturedAt <= temporalWindowMs
    )),
    next,
  ].slice(-maxReadings);
}
