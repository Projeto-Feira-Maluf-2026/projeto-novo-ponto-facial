# Terminal automático de ponto

## Objetivo

A tela `Ponto automático` foi desenhada para funcionar em uma câmera fixa, sem seleção manual de funcionário, tipo de ponto ou botão de confirmação. O colaborador se aproxima, olha para a câmera e recebe uma resposta visual imediata.

## Fluxo de operação

1. O terminal inicia a câmera e seleciona a obra vinculada.
2. Uma imagem é analisada a cada 850 ms, sempre com apenas uma requisição em andamento.
3. O reconhecimento evolui por `UNKNOWN → POSSIBLE → CONFIRMING → CONFIRMED` em uma janela de quatro segundos.
4. As três evidências aceitas são preservadas e enviadas juntas ao servidor. A API reprocessa os frames, valida a consistência temporal e agrega os embeddings antes de decidir.
5. O tipo de movimento é decidido pela regra de jornada da API.
6. O resultado permanece visível por seis segundos.
7. Um bloqueio local de 45 segundos impede uma nova batida acidental do mesmo funcionário.

O terminal pode ser pausado pelo operador e possui modo de tela cheia. Nenhum score biométrico interno é exposto ao colaborador.

## Estados visuais

- **Aguardando:** orienta o posicionamento sem poluir a imagem.
- **Confirmando:** mostra o progresso das três leituras estáveis.
- **Sucesso:** nome, movimento registrado e horário.
- **Atenção:** informa falta de luz, desfoque, mais de um rosto ou falha de serviço.
- **Conferência:** comunica que o registro foi recebido para revisão.
- **Pausado:** interrompe novas leituras sem desligar toda a aplicação.

## Requisitos recomendados para a câmera

- resolução mínima prática de 1280 × 720;
- captura estável em 25 ou 30 FPS;
- instalação frontal, aproximadamente na altura do rosto;
- iluminação uniforme e sem janela ou refletor diretamente atrás da pessoa;
- distância de operação marcada no piso e verificada no local;
- conexão cabeada para câmeras IP sempre que possível.

A qualidade final não deve ser homologada apenas por resolução nominal. Antes de colocar o terminal em produção, valide taxa de aceitação e rejeição com a câmera real, nas condições de luz da manhã, meio-dia e noite.

## Observação técnica importante

A consistência temporal agora é revalidada pela API e reduz decisões baseadas em um único frame. Ela não deve ser chamada de prova de vida: o runtime atual não possui PAD/liveness homologado. Para elevar a resistência a foto, tela ou replay, ainda é necessário integrar e calibrar um modelo de apresentação de ataque com uma base representativa das câmeras reais.

## Arquivos principais

- `web/src/pages/FacialTerminalPage.tsx`: máquina de estados e registro automático;
- `web/src/components/CameraCapture.tsx`: câmera e enquadramento discreto;
- `web/src/components/Layout.tsx`: navegação responsiva;
- `web/src/styles.css`: sistema visual, estados e responsividade;
- `web/src/services/api.ts`: cancelamento de requisições de reconhecimento.
