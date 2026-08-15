# Curitiba Gestão — Design System

**Produto:** controle de presença e reconhecimento facial para obras

**Direção:** central operacional industrial, precisa e humana

**Densidade:** alta, sem sacrificar leitura

**Motion:** discreto, funcional e sempre cancelável por `prefers-reduced-motion`

## Princípios

1. A câmera e o estado do registro são protagonistas; decoração nunca compete com a tarefa.
2. A interface deve continuar legível se bordas e sombras forem removidas.
3. Métricas formam um quadro operacional contínuo, não uma grade genérica de quatro cards.
4. Laranja-sinal indica ação ou atenção. Verde confirma segurança. Nenhuma cor é apenas decorativa.
5. Cantos são técnicos: 2–8 px. Formas circulares ficam restritas a indicadores e avatares.
6. Dados reais, mensagens específicas e estados honestos substituem textos genéricos.

## Tokens semânticos

| Papel | Claro | Escuro |
|---|---:|---:|
| Canvas | `#F2F1ED` | `#0C1013` |
| Superfície | `#FCFCFA` | `#141A1E` |
| Superfície elevada | `#FFFFFF` | `#1B2328` |
| Texto | `#1A2024` | `#F3F5F5` |
| Texto secundário | `#58636A` | `#AAB5BA` |
| Linha | `#D6D8D5` | `#303A40` |
| Linha forte | `#AAB0B1` | `#526068` |
| Ação | `#C44B18` | `#FF8A4C` |
| Ação forte | `#963510` | `#FFB087` |
| Sucesso | `#08775A` | `#57CAA2` |
| Atenção | `#8A5A00` | `#E7B84B` |
| Perigo | `#B42318` | `#FF8D83` |

O código usa camadas `--raw-*`, `--color-*` e, quando necessário, tokens de componente. Componentes não devem depender diretamente de cores brutas.

## Tipografia

- Títulos: **Lexend Variable**, 500–650, tracking negativo sutil.
- Corpo e dados: **Source Sans 3 Variable**, 400–700.
- Números operacionais: Source Sans 3 com `font-variant-numeric: tabular-nums`.
- Um único `h1` por tela; subtítulos seguem a hierarquia sem pular níveis.

## Espaçamento e forma

- Escala: `4, 8, 12, 16, 24, 32, 48, 64` px.
- Controles: mínimo 44 px de altura/alvo.
- Raios: `2px` técnico, `5px` controle, `8px` painel, `12px` apenas diálogo grande.
- Sombras: somente menus, diálogo e câmera em tela cheia. Painéis usam contraste e estrutura, não elevação falsa.

## Composição

- Desktop: masthead horizontal + navegação contextual; não usar sidebar genérica permanente.
- Mobile: cabeçalho compacto e navegação inferior com área segura.
- Dashboard: placar diário assimétrico, fluxo horário e distribuição por obra.
- Tabelas: cabeçalho persistente quando útil, ações contextuais e alternativa rolável no mobile.
- Formulários: agrupados por tarefa; rótulos sempre visíveis; feedback junto à ação.
- Empty states: explicam o que falta e oferecem o próximo passo real.

## Estados

Todo fluxo relevante implementa: `idle`, `loading`, `success`, `error`, `empty` e `disabled`. Reconhecimento facial adiciona `UNKNOWN`, `POSSIBLE`, `CONFIRMING` e `CONFIRMED`. O estado não pode depender apenas de cor.

## Motion

- Feedback de controle: 140–180 ms.
- Entrada de página/painel: 220–300 ms, opacidade + deslocamento máximo de 8 px.
- Indicadores de reconhecimento: interpolação contínua sem pulos visuais.
- Sem `transition: all`, sem bounce em tabelas, sem glow decorativo.
- Em `prefers-reduced-motion`, duração efetiva próxima de zero e nenhum movimento contínuo.

## Acessibilidade e responsividade

- Contraste de texto WCAG AA; foco de 2 px com offset visível.
- Labels associadas, mensagens com `role="alert"`/`status`, modais com trap de foco e Escape.
- Validar 375, 768, 1024 e 1440 px; nenhuma rolagem horizontal da página.
- Câmera e ações críticas permanecem utilizáveis com teclado e toque.

## Proibido

- Gradientes genéricos, glassmorphism, glows ou “AI purple”.
- Cards dentro de cards e grades perfeitamente uniformes sem razão funcional.
- Pills para texto comum, ícones decorativos em cada linha ou hero de marketing no app autenticado.
- Botões sem ação, dados simulados em produção, spinners centrais como único skeleton.
- Hovers que mudam layout, texto abaixo de 12 px para informação operacional ou bordas arredondadas excessivas.

## Checklist

- [ ] Fluxos reais preservados e controles têm ação.
- [ ] Estados loading/error/empty/success presentes.
- [ ] Alvos de toque ≥ 44 px e foco visível.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Sem overflow em 375/768/1024/1440.
- [ ] Login, dashboard, cadastro e terminal parecem partes do mesmo produto.
- [ ] Câmera funciona com webcam local e backend facial remoto HTTPS.
