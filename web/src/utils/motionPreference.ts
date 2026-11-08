/**
 * Animações seguem só o botão "Reduzir animações" do app (data-motion-mode no <html>).
 * A preferência do sistema não desliga tudo sozinha: muitos Windows vêm com
 * "efeitos de animação" desligados e o painel ficava parado.
 */
export function motionReduced() {
  return document.documentElement.dataset.motionMode === 'reduced';
}
