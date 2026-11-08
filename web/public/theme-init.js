// Aplica o tema antes do primeiro paint (sem piscar). Arquivo externo porque a
// CSP do app nao permite script inline. Primeira visita segue o tema do sistema.
(function () {
  var dark = false;
  try {
    var stored = localStorage.getItem('theme');
    dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (error) {
    dark = false;
  }
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
