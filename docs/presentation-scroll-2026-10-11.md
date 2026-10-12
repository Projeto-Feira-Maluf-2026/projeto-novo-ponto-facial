# Apresentação cinematográfica — Curitiba Empreiteira

## Diagnóstico e direção

P1 visual: a apresentação usava entradas isoladas, sem uma sequência de scroll
com começo, transformação e conclusão. P2: havia processamento contínuo de animação
mesmo com movimento reduzido, e controles/estados de carregamento precisavam de
um contrato consistente. Não houve alteração de autenticação, biometria ou banco.

A nova direção mantém o verde como detalhe da marca e o canteiro Three.js, com uma revisão clara inspirada em apresentações de iPhone: tipografia nativa de sistema, branco/grafite, vidro fosco, pedra clara e prata. A fotografia real da escola e os cinco
integrantes foram preservados. A segunda seção usa quatro imagens sintéticas
editoriais; não são fotografias de participantes nem evidência biométrica.

## Efeitos e função

| Efeito | Aplicação |
| --- | --- |
| Staggered Fade In / Scroll Reveal | Abertura por linhas, títulos por palavras e capítulos/equipe |
| Scroll Scrubbing / Sticky Sections | Transformação sincronizada entre imagem, identidade, registro e retorno |
| Card Stack / cards em 3D | Deck da arquitetura; cards saem alternadamente para os lados |
| Card Lift / Spotlight / Tilt | Superfícies dos cards, com atualização de cursor em requestAnimationFrame |
| Horizontal Scroll | Portaria, gestão e participante no capítulo de impacto, em desktop |
| Parallax / Image Scale | Fotografia da escola e continuidade da cena da obra |
| Shared Element / Smooth Page Transition | View Transitions API nas rotas internas; símbolo da marca compartilhado |
| Spring / Magnetic / Icon Slide | Controles da apresentação, com movimento limitado |
| Animated Tabs | Indicador das obras acompanha a seleção; teclado e ARIA preservados |
| Skeleton Shimmer | Carregamento de rota/tabela; tabela informa aria-busy e status acessível |
| Animated Gradient Border | Uma borda com reflexo móvel na evidência final |
| Curtain Transition | Abertura e fechamento da apresentação |

## Acessibilidade, operação e desempenho

- `prefers-reduced-motion` e preferência de movimento reduzido do produto removem
  animações de interface. A versão reduzida mantém todo o conteúdo no fluxo natural.
- GSAP usa matchMedia e reverte timelines ao trocar de breakpoint/preferência.
  Lenis, listeners, ResizeObserver, timers e recursos WebGL são liberados ao sair.
- Em movimento reduzido, a cena WebGL é redesenhada em resposta a scroll/resize;
  não há loop contínuo de animação.
- Cards com tilt são decorativos: nenhum conteúdo essencial depende de hover.
  Scroll normal e teclado continuam utilizáveis.
- Não são interceptados links externos, downloads, nova aba, gestos com modificadores
  ou âncoras/filtros na mesma rota. Guards de autorização continuam existentes.
- Quatro WebP de 960×960 totalizam 259.542 bytes. Dimensões são declaradas; decodificação
  é assíncrona. O desenho SVG anterior foi substituído pelas imagens. A primeira série escura foi preservada apenas no cache local; a série clara é a final publicada.
- Tailwind 4 foi adotado para daisyUI 5; o preflight anterior foi preservado. O plugin
  usa prefixo `film-`, tema local e somente o módulo de botões, sem tematizar o ERP inteiro.
- Prévia local: `/apresentacao/resumo?preview=1`. Para comparar a animação apesar da
  emulação de movimento reduzido do navegador de teste, usar `&motion=full`. Esse
  override depende de `import.meta.env.DEV` e não existe em produção.

## Referências usadas

- TypeUI: fundamentos locais de acessibilidade, espaçamento, tipografia, UI e UX.
- daisyUI: https://daisyui.com/docs/config/ e componentes oficiais.
- GSAP: https://gsap.com/docs/v3/Plugins/ScrollTrigger/ e
  https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/.
- Pesquisa visual: arquitetura e storytelling em https://www.awwwards.com/inspiration/scroll-portfolio.

## Imagens e prompts

Geração pela ferramenta nativa ImageGen. Arquivos finais:
`web/public/presentation/{capture,identity,record,confirmation}-light.webp`.

Prompt comum: square editorial 3D artwork for a premium Portuguese construction/
facial-attendance presentation; deep forest green #13271f, pale sage #a3b18a,
warm ivory #f2f1e8, restrained brushed brass, realistic matte concrete and frosted
glass, studio photography of a sculptural model, subtle volumetric lighting, tactile
materials, centered subject with clean background. No neon, cyberpunk, generic
SaaS illustration, words, labels, letters, numbers, logos or real identifiable person.

- Capture: anonymous translucent jade-glass face, embedded metallic landmark nodes,
  minimal machined camera frame, illustrating facial capture.
- Identity: face sculpture dissolving into suspended ivory/sage ceramic rods and
  brass connections, facial contour transitioning into organized characteristics.
- Record: four floating thin concrete/glass slabs above a stone foundation,
  embossed sage-metal check mark and brass connectors, illustrating a linked record.
- Confirmation: warm ivory folded envelope, translucent sage confirmation seal with
  check mark, dark concrete pedestal, warm edge light and realistic paper fibers.

Prompt final de edição da série: redesign each synthetic product sculpture into a refined minimal premium hardware editorial image, inspired by iPhone launch photography. Preserve subject and shape; remove ornate gold/brass. Seamless white #f5f5f7 background with grounded studio shadow; satin silver aluminum, frosted glass, pale stone, muted forest green #3a5a40 accents. Precise realistic lighting and macro material detail. No words, numbers, logos, UI, watermark or real person's photo. Square composition, subject comfortably inside the frame, more breathing space.

Referências adicionais da revisão clara: https://developer.apple.com/design/human-interface-guidelines/materials e https://developer.apple.com/design/human-interface-guidelines/foundations.

## Validação e rollback

62 testes frontend passaram com a revisão dos cards e imagens; testes de
navegação cobrem destinos internos e a preservação dos gestos do navegador. Tipos
e build passaram. Auditoria npm: zero vulnerabilidades conhecidas no lockfile final.
Revisão manual: desktop, 390×844, movimento normal/reduzido, assets e console.
O aviso preexistente do chunk Three.js acima de 500 kB continua documentado.

Rollback: reverter o commit desta apresentação, ou restaurar o deploy frontend
anterior `d7621e4`. Não há migrations, alterações de registros nem rollout do serviço facial.
