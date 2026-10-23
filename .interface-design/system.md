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
- Animações de entrada devem terminar com `transform: none` e não podem manter `will-change` em containers com texto; as camadas de composição são temporárias para preservar a nitidez após o encaixe.
- Todo movimento deve explicar: foco, mudança de estado, detecção, confirmação ou fluxo de dados.
- Modais entram com fade de fundo em 180 ms e superfície em 260 ms, deslocando no máximo 8 px.
- Respeitar `prefers-reduced-motion`, touch, economia de dados e hardware limitado.
- A preferência do cabeçalho permite escolher movimento completo ou reduzido; para este produto, movimento completo é o padrão solicitado.

## 3D utilitário

- Terminal: efeitos CSS 3D leves para não disputar GPU com webcam/MediaPipe; a geometria acompanha estados existentes e não adiciona espera.
- Obras: Three.js continua como única cena WebGL principal, com marcador do acesso e onda de atividade.
- Elementos de RA/RV são linguagem espacial na tela (malha, feixe, profundidade e localização), não promessa de suporte a headset.
- A troca de páginas é imediata e monta a própria interface: cabeçalho, superfícies, cards e painéis chegam alternadamente dos quatro cantos e se encaixam em cascata. Não usar tela intermediária cobrindo a navegação.
- A assinatura dessa montagem é de canteiro, não de dashboard genérico: malha de implantação transitória, pequeno encaixe magnético no destino, linha de levantamento sob o título e cantos de aferição que piscam somente ao concluir o posicionamento.
- Selos de vidro aparecem somente após confirmação real do backend.

## Acessibilidade e desempenho

- Estados críticos não dependem apenas de cor ou animação.
- Foco de teclado sempre visível; alvos mínimos de 44 px em ações principais.
- Efeitos decorativos usam `aria-hidden` e `pointer-events: none`.
- Nunca comprometer captura, detecção facial ou registro para manter animações.

## Terminal de ponto

- A câmera é a superfície principal e ocupa praticamente toda a altura útil; não dividir o terminal com uma coluna lateral de cards.
- Manter somente uma barra superior compacta para obra, pausa e tela cheia, mais uma faixa inferior única para estado, horário e último registro.
- Etapas de fluxo, diagnósticos repetidos, textos explicativos e histórico completo pertencem a outras telas, não ao terminal operacional.
- Sobre o vídeo, exibir apenas enquadramento facial, estado curto da câmera, seletor quando houver mais de um dispositivo e ação de reinício.
- Não usar tilt, totem 3D, scan line ou ornamento permanente sobre a webcam; a prioridade visual e de GPU é a captura.
- A evidência enviada ao backend é um snapshot interno. Nunca cobrir ou congelar o vídeo para mostrá-la; câmera e rastreamento continuam ao vivo durante o processamento.

## Relatórios e auditoria

- Auditoria não ocupa uma rota na navegação principal. Ela é uma seção interna de Relatórios para reduzir duplicação de destinos administrativos.
- A seção Auditoria aparece somente para `SUPER_ADMIN` e `RH`; gestores de obra continuam vendo apenas exportações autorizadas.
- O estado da seção fica na URL (`/relatorios?view=audit`) e a rota legada `/auditoria` redireciona para ela sem quebrar favoritos.

## Exclusão de funcionário

- A lixeira representa exclusão permanente e aparece somente para `SUPER_ADMIN`; inativação deve usar linguagem e controle próprios quando voltar a existir.
- A confirmação explicita que cadastro, foto, biometria, vínculos, pontos e tentativas associadas serão apagados e que a ação não pode ser desfeita.
- A interface só remove a linha depois da resposta `204`; falhas mantêm o cadastro visível. O backend usa uma transação e registra apenas uma auditoria mínima da exclusão concluída.

## Modo apresentação

- O modo normal continua sendo a fonte de verdade operacional. A apresentação apenas reorganiza dados e oferece atalhos para os fluxos reais; não inventa métricas nem simula confirmações.
- O acionamento fica discreto no cabeçalho. Quando ativo, ganha uma rota própria e pode ser encerrado sem alterar cadastros ou configurações do sistema.
- O roteiro oficial da feira é: cadastro com e-mail, matrícula facial, ponto pela câmera e confirmação do registro/e-mail.
- Cadastro rápido gera uma matrícula de feira, exige e-mail e abre a matrícula facial automaticamente após salvar.
- Contadores da sessão reagem somente a confirmações emitidas pelo terminal. E-mail aparece como enviado somente quando o backend recebe sucesso do SMTP.
- O painel usa composição de console/roteiro, sem hero promocional genérico, depoimentos, números falsos, brilho decorativo ou excesso de cards.
- Após um ponto realmente aceito, o modo apresentação abre a apresentação automática por cima do terminal, sem troca de rota, convite ou confirmação. O módulo é pré-carregado assim que o modo apresentação é ligado, então abre sem espera.
- O resultado passa em memória para a apresentação; nome, horário e biometria nunca vão para a URL ou para armazenamento persistente.
- A apresentação é um filme de 9 cenas que avança sozinho (cerca de 70 s): boas-vindas pelo primeiro nome (ou "Oi, pessoal!" para grupos), encontrar o rosto, virar código, comparar, registrar, cuidado com os dados, escola, equipe e agradecimento. Ao final volta sozinha para a câmera.
- Há controles discretos de voltar, pausar, avançar e "Voltar à câmera", segmentos de progresso clicáveis e atalhos de teclado (setas, espaço e Esc). Conteúdo que se move sozinho por mais de 5 s precisa poder ser pausado.
- A versão clara (branco, grafite e verdes da marca) é a padrão. Um mini botão sol/lua alterna para a versão escura ("obra à noite"); a escolha fica salva no navegador.
- Os textos falam como gente: frases curtas, segunda pessoa, sem jargão ("embedding", "backend", "pipeline"). O e-mail só é descrito como enviado quando o SMTP confirmou; quando está na fila, diz "a caminho".
- Ilustrações (pontos do rosto, anel de 512 números, cartões de comparação) são desenhos em SVG/CSS e trazem a legenda de ilustração. Nunca mostram imagem da câmera, score biométrico ou código real.
- O fundo é uma obra em traço técnico que ganha um andar por cena e fica pronta no final, com guindaste acompanhando o progresso. A escola continua sendo a única cena fotográfica (Colégio Maluf, com crédito).
- Sem WebGL, GSAP ou rolagem: só transform/opacity e stroke de SVG pequeno. Enquanto a apresentação está aberta, o rastreamento facial do terminal fica suspenso e a câmera continua ligada.
- Créditos usam composição de ficha técnica com os cinco integrantes e funções reais; não inventar retratos, depoimentos ou cargos.
- A identificação envia um único recorte interno do rosto para reduzir a latência. O vídeo nunca congela e a captura não aparece na interface.
- O rastreamento combina landmarks rápidos com uma varredura full-range do quadro inteiro. As caixas dos dois detectores são fundidas para manter pessoas próximas e distantes no mesmo grupo.
- Durante uma presença contínua, os rostos já registrados ficam bloqueados por posição até saírem do quadro; uma nova pessoa que entra continua elegível sem duplicar quem permaneceu diante da câmera.
- A montagem normal anima módulos de primeiro nível, não todos os seus descendentes. O efeito espacial permanece sem criar dezenas de camadas de composição em telas densas.
- O indicador da navegação usa transição CSS nativa; engines de motion ficam restritas às rotas e experiências que realmente precisam delas, sem custo no carregamento inicial.

## Apresentação — revisão de 22/10/2026

- Substitui a narrativa por rolagem de 11/10 (daisyUI `film-`, deck de cards, imagens IA e canteiro WebGL). Visitante em pé diante do terminal não rola a página: a história agora anda sozinha.
- A versão clara herda a direção "inspiração iPhone" daquela revisão: fundo branco/`#f6f6f2`, grafite `#13271f`, verde `#3f7d4a` como acento, cartões brancos com sombra suave e raio de 20 a 26 px. Tipografia Lexend nos títulos e Source Sans 3 no texto.
- A versão escura usa `#07110c`, marfim `#f2f1e8` e sálvia `#c9e69c`. As duas compartilham tokens (`--show-*`) definidos em `web/src/presentation/presentation-show.css`.
