# Curitiba Empreiteira — sistema visual operacional

## Direção

- Interface de produto operacional, tátil e precisa; evitar estética genérica de landing page.
- Paleta principal: `#dad7cd`, `#a3b18a`, `#588157`, `#3a5a40`, `#344e41`.
- Preservar o gêmeo digital Three.js existente da tela Obras. Evoluções devem ampliar seus estados, nunca substituí-lo por ilustração estática.
- O símbolo oficial combina volume de obra e lente facial no hexágono arredondado.

## Profundidade e superfícies

- Base tonal sólida. Vidro fosco apenas no cabeçalho fixo, modais e painéis realmente elevados.
- `backdrop-filter: blur(12px)` é o teto normal; sempre manter borda translúcida e contraste de texto.
- Sombras baixas e verdes/neutras. Glow aparece em hover, foco ou confirmação; nunca permanente em todos os cards.
- Dashboard pode usar tilt de 2–3 graus. Terminal aceita no máximo 1.2 grau e volta ao plano durante reconhecimento e envio.

## Movimento

- Microinterações: 140–210 ms; entradas: 340–480 ms; eventos espaciais: até 1.2 s.
- Spring oficial: `cubic-bezier(.34, 1.56, .64, 1)`.
- Animar somente `transform` e `opacity` sempre que possível. Nunca usar `transition: all`.
- Todo movimento deve explicar: foco, mudança de estado, detecção, confirmação ou fluxo de dados.
- Modais entram com fade de fundo em 180 ms e superfície em 260 ms, deslocando no máximo 8 px.
- Respeitar `prefers-reduced-motion`, touch, economia de dados e hardware limitado.

## 3D utilitário

- Terminal: efeitos CSS 3D leves para não disputar GPU com webcam/MediaPipe; a geometria acompanha estados existentes e não adiciona espera.
- Obras: Three.js continua como única cena WebGL principal, com marcador do acesso e onda de atividade.
- Elementos de RA/RV são linguagem espacial na tela (malha, feixe, profundidade e localização), não promessa de suporte a headset.
- A troca de páginas usa uma passagem espacial curta com planos em profundidade, malha, scanner e o nome real do destino; nunca usa GIF remoto.
- Selos de vidro aparecem somente após confirmação real do backend.

## Acessibilidade e desempenho

- Estados críticos não dependem apenas de cor ou animação.
- Foco de teclado sempre visível; alvos mínimos de 44 px em ações principais.
- Efeitos decorativos usam `aria-hidden` e `pointer-events: none`.
- Nunca comprometer captura, detecção facial ou registro para manter animações.
