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
- Após um ponto realmente aceito, o modo apresentação segue diretamente para o resumo imersivo em uma rota própria; não há convite, confirmação ou escolha intermediária.
- A transferência para a página de resumo acontece em memória durante a navegação da SPA e não coloca nome, matrícula, horário ou biometria na URL ou no armazenamento persistente.
- O resumo usa a linguagem de “dossiê vivo da passagem”: estrutura espacial de obra, lente facial e fluxo captura → IA → regra → registro → e-mail. A intensidade 3D pertence somente a essa narrativa, nunca ao terminal normal.
- A narrativa do resumo é uma exceção deliberada ao movimento reduzido do produto: permanece cinematográfica e contínua durante a apresentação, sem controle de pausa, conforme a direção definida para a feira.
- A página isolada de resumo usa Lenis + GSAP/ScrollTrigger para uma única linha do tempo ligada ao scroll e uma cena Three.js com shader autoral. Tudo é carregado sob demanda, fora do terminal, com DPR limitado, pausa fora da viewport e fallback CSS quando WebGL não estiver disponível.
- O 3D deve explicar captura, comparação, registro e estrutura em camadas. Não copiar cenas, modelos ou identidade de referências externas; a assinatura visual continua sendo obra + lente facial + levantamento técnico.
- O fundo persistente do resumo é um canteiro vertical procedural: estrutura de concreto inacabada, volumes escalonados, andaimes leves, tela de proteção, materiais e guindaste. A cena é geometria Three.js gerada no navegador, nunca rosto abstrato, fotografia de mansão ou imagem estática, e a placa usa exclusivamente `CURITIBA EMPREITEIRA`. O capítulo da escola é a exceção editorial: preserva a fotografia real do Colégio Maluf, seu véu de contraste, parallax e crédito da fonte.
- Os capítulos do resumo podem ocupar várias alturas de viewport e usar composição sticky, desde que o mobile volte ao fluxo linear. A escola é o único capítulo fotográfico: imagem real do Colégio Maluf em tela cheia, com véu de contraste, parallax e crédito visível da fonte.
- O resumo cinematográfico inicia GSAP, scroll suave, WebGL e animações CSS automaticamente e os mantém ativos durante toda a experiência. Não exibe ações “Ativar experiência completa”, “Pausar movimento” ou “Continuar movimento”; somente ausência real de suporte WebGL aciona o fallback visual.
- A primeira tela do resumo contém apenas o texto real do registro à esquerda e a obra WebGL persistente ao fundo. Não sobrepor cubo facial, anéis, coordenadas ou etiquetas de pipeline na área direita.
- No encerramento, a mesma obra 3D reaparece com mais presença, escala e contraste atrás do texto final; a cena não pode terminar em um fundo liso ou lavado.
- A autoria do projeto é o capítulo 06 do próprio resumo, com os cinco integrantes e suas funções reais; não abre rota ou página paralela.
- A navegação do resumo é linear pelo scroll e não exibe a régua lateral de miniatalhos numerados.
- Créditos usam composição editorial de ficha técnica, números e monogramas tipográficos. Não inventar retratos, depoimentos, cargos ou biografias; a força visual vem do movimento e da hierarquia dos nomes.
- A identificação envia um único recorte interno do rosto para reduzir a latência. O vídeo nunca congela e a captura não aparece na interface.
