# Terminal automático de ponto

## Objetivo

A tela `Ponto automático` foi desenhada para funcionar em uma câmera fixa, sem seleção manual de funcionário, tipo de ponto ou botão de confirmação. O colaborador se aproxima, olha para a câmera e recebe uma resposta visual imediata.

## Fluxo de operação

1. O terminal inicia a câmera e seleciona a obra vinculada.
2. Uma imagem é analisada a cada 1,35 segundo, sempre com apenas uma requisição em andamento.
3. O mesmo funcionário precisa ser reconhecido em três leituras consecutivas.
4. O frontend solicita o registro ao servidor; o tipo de movimento é decidido pela regra de jornada da API.
5. O resultado permanece visível por seis segundos.
6. Um bloqueio local de 45 segundos impede uma nova batida acidental do mesmo funcionário.

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

As três leituras estáveis e o bloqueio de repetição melhoram a experiência e evitam disparos acidentais no frontend, mas não substituem prova de vida temporal no servidor. Para elevar a resistência a fraude, o próximo incremento deve incluir uma sessão de reconhecimento com desafio, sequência temporal de frames e decisão de liveness validada pela API.

## Arquivos principais

- `web/src/pages/FacialTerminalPage.tsx`: máquina de estados e registro automático;
- `web/src/components/CameraCapture.tsx`: câmera e enquadramento discreto;
- `web/src/components/Layout.tsx`: navegação responsiva;
- `web/src/styles.css`: sistema visual, estados e responsividade;
- `web/src/services/api.ts`: cancelamento de requisições de reconhecimento.
