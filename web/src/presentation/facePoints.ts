/**
 * Pontos de referência ilustrativos de um rosto (contorno, sobrancelhas, olhos,
 * nariz e boca) num quadro de 400 × 520. É um desenho, nunca dado biométrico.
 */
export const FACE_POINTS: Array<[number, number]> = (() => {
  const points: Array<[number, number]> = [];
  for (let step = 0; step <= 16; step += 1) {
    const angle = Math.PI * (0.06 + (step / 16) * 0.88);
    points.push([200 - Math.cos(angle) * 128, 196 + Math.sin(angle) * 168]);
  }
  [[-1, 0], [1, 0]].forEach(([side]) => {
    for (let step = 0; step < 5; step += 1) points.push([200 + side * (40 + step * 15), 160 - Math.sin((step / 4) * Math.PI) * 14]);
    for (let step = 0; step < 6; step += 1) {
      const angle = (step / 6) * Math.PI * 2;
      points.push([200 + side * 64 + Math.cos(angle) * 22, 196 + Math.sin(angle) * 9]);
    }
  });
  for (let step = 0; step < 5; step += 1) points.push([200, 190 + step * 18]);
  [[-22, 276], [-11, 280], [0, 282], [11, 280], [22, 276]].forEach(([x, y]) => points.push([200 + x, y]));
  for (let step = 0; step <= 10; step += 1) {
    const angle = Math.PI * (step / 10);
    points.push([200 - Math.cos(angle) * 44, 322 + Math.sin(angle) * 14 - (step === 0 || step === 10 ? 0 : 4)]);
  }
  return points;
})();
