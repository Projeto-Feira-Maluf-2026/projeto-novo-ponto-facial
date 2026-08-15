# Curitiba Gestão — Design System Premium Mineral

**Produto:** gestão de presença e reconhecimento facial para obras

**Direção:** B2B premium, engenharia contemporânea, humana e confiável

**Personalidade:** precisão sem frieza; tecnologia sem estética genérica de SaaS

**Densidade:** moderada no contexto e alta apenas nos dados operacionais

## Princípios

1. Em até três segundos o dashboard informa obras ativas, presentes, ausentes, horas, alertas e concentração de atividade.
2. A composição é editorial e assimétrica: módulos variam conforme importância, sem grades repetitivas de cards idênticos.
3. Verde floresta comunica estrutura e ação; neutros minerais quentes mantêm o produto acolhedor.
4. O gêmeo digital 3D é funcional: contextualiza a obra e oferece exploração progressiva, sem bloquear o restante da página.
5. Nenhuma tela inventa dados. Indisponibilidade do contrato da API é assumida de forma honesta.
6. Estados e ações não dependem apenas de cor; ícone, texto, contraste e movimento trabalham juntos.

## Arquitetura de tokens

O código usa três camadas:

1. Primitiva: `--mineral-*`, `--forest-*`, `--red-*`, `--amber-*`.
2. Semântica: `--color-canvas`, `--color-surface`, `--color-accent`, `--color-success`.
3. Componente: `--button-*`, `--card-*`, `--radius-*`, `--shadow-*`.

Componentes não usam cores brutas quando existe token semântico apropriado.

## Paleta semântica

| Papel | Tema claro | Tema escuro |
|---|---:|---:|
| Canvas | `#F7F5ED` | `#111A15` |
| Superfície | `#FFFEF9` | `#18241D` |
| Superfície elevada | `#FFFFFF` | `#1D2B23` |
| Texto | `#18211B` | `#F6F4EC` |
| Texto secundário | `#566159` | `#BDC8BF` |
| Linha | `#DEDDD2` | `#34473B` |
| Ação | `#2F6844` | `#79B987` |
| Ação forte | `#183F2A` | `#A6D3AD` |
| Sucesso | `#257148` | `#80C997` |
| Atenção | `#A87521` | `#E5BD73` |
| Perigo | `#B64B44` | `#F29A91` |

## Tipografia

- Títulos: **Lexend Variable**, pesos 500–650 e tracking negativo.
- Corpo e dados: **Source Sans 3 Variable**, pesos 400–750.
- Métricas usam números tabulares.
- Um `h1` por tela. Módulos usam `h2` e conteúdo interno usa `h3`.
- Texto operacional nunca fica abaixo de 12 px; microtexto de apoio pode usar 10,5–11 px quando não carrega decisão.

## Forma e profundidade

- Cards: 20–28 px.
- Painéis principais: 28 px.
- Controles: 14–16 px.
- Botões: 14 px.
- Alvos interativos: mínimo 44 × 44 px.
- Sombras são suaves, verdes e de baixa opacidade; hover aumenta elevação sem alterar o layout.
- Pills ficam restritas a status, conectividade e metadados curtos.

## Composição por área

### Dashboard

- Hero compacto em verde floresta com resumo e presença circular.
- Mosaico de métricas com pesos distintos.
- Gráfico horário e ranking por obra com dados reais.
- Alertas e ausência aparecem como atenção operacional, não como decoração.

### Obras

- Portfólio lateral e painel principal contextual.
- Gêmeo digital 3D lazy-loaded, pausado fora da viewport e reduzido no mobile.
- Movimentações, dispositivos, responsável, geofence e prontidão derivam somente do backend.
- Progresso físico não aparece até existir no contrato da API.

### Funcionários

- Identidade visual com avatar/iniciais.
- Busca e filtros preservados.
- Detalhes abrem em drawer; edição e matrícula facial continuam no mesmo contexto.
- Campos não fornecidos pela API não são simulados.

### Ponto facial

- Fluxo visível: Câmera → Reconhecimento → Identificado → Registrado.
- Câmera continua protagonista.
- Movimento respiratório existe apenas no estado ativo.
- Em falha, a mensagem explica a próxima ação possível.

### Câmeras

- Portfólio visual com status, local, última atividade e ações no hover/foco.
- Somente a fonte selecionada abre stream/snapshot, evitando custo desnecessário.
- Configuração mantém teste obrigatório antes de salvar.

## Motion

- Microinteração: 140–210 ms.
- Entrada de página: 340–480 ms.
- Drawer: 360 ms.
- Hover: 220–260 ms.
- Stagger curto: 40–54 ms.
- Easing principal: `cubic-bezier(.22, 1, .36, 1)`.
- Movimento contínuo somente em indicadores ativos e visualização 3D.
- `prefers-reduced-motion` remove pulsos, entrada espacial e movimentos ambientais.

## Acessibilidade

- Contraste WCAG AA.
- Foco visível de 2 px com offset de 3 px.
- Labels sempre visíveis e associados.
- Mensagens dinâmicas usam `role="status"` ou `role="alert"`.
- Dialogs e drawers fecham com Escape.
- Navegação de seleção de obras usa padrão de tabs e setas.
- Alternativa textual acompanha gráficos e canvas 3D.

## Performance

- Rotas são lazy-loaded.
- O módulo Three.js fica em chunk separado e só monta perto da viewport.
- O renderer 3D pausa fora da viewport e com a aba oculta.
- Pixel ratio é limitado; recursos WebGL são liberados ao desmontar.
- Prévia de câmera só é buscada ao selecionar uma fonte.

## Breakpoints de validação

- 375 px: navegação inferior, módulos em coluna e 3D simplificado.
- 768 px: hero e digital twin em composição dividida.
- 1024 px: navegação horizontal e painéis operacionais lado a lado.
- 1440 px: composição editorial completa, com largura de leitura controlada.

## Critérios de aceite

- [ ] Fluxos reais preservados.
- [ ] Loading, error, empty, success e disabled presentes.
- [ ] Nenhum dado operacional simulado em produção.
- [ ] 3D carregado sob demanda e funcional com teclado/toque.
- [ ] Sem overflow horizontal em 375/768/1024/1440.
- [ ] Foco, contraste e reduced motion validados.
- [ ] Login, dashboard, funcionários, obras, câmeras, relatórios e terminal compartilham a mesma linguagem.
