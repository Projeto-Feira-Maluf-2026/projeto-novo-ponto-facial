# Terminal automático de ponto

## Objetivo

A tela `Ponto automático` foi desenhada para funcionar em uma câmera fixa, sem seleção manual de funcionário, tipo de ponto ou botão de confirmação. O colaborador se aproxima, olha para a câmera e recebe uma resposta visual imediata.

## Fluxo de operação (atualizado em 09/11/2026)

1. O terminal inicia a câmera e seleciona a obra vinculada.
2. O MediaPipe, no próprio navegador, acompanha até cinco rostos a cada quadro. Nada vai ao servidor enquanto ninguém novo aparece.
3. Quando surge um rosto que ainda não foi tratado, o terminal tira uma foto só desse rosto (recorte de 384 a 576 px) e envia todos os novos da mesma leitura juntos em `POST /attendance/punch/batch`.
4. Quem já foi registrado é seguido de quadro em quadro (`web/src/pages/terminalFaceMemory.ts`) e não é fotografado de novo enquanto continua diante da câmera. Quem sai do quadro é esquecido depois de 0,9 s.
5. Um rosto que falha (sem cadastro, mal posicionado) é tentado de novo com espera crescente: 150 ms nas três primeiras falhas, 600 ms até a quinta e 1,5 s depois disso. Assim ele não atrasa quem acabou de chegar.
6. Leitura em ondas: com o modo apresentação ligado, o grupo fica aberto por 4 s depois do último registro ou da última chegada (`GROUP_WAVE_WINDOW_MS`). Quem aparecer nesse intervalo é fotografado, reconhecido e entra na mesma apresentação. O prazo máximo do grupo é 20 s.
7. O servidor decide identidade, tipo de movimento (regra de jornada) e duplicidade (janela de 1 min). Em grupo, a inferência de todos os rostos começa de uma vez e o banco de cada batida roda enquanto o rosto seguinte ainda está no modelo.

O terminal pode ser pausado pelo operador e possui modo de tela cheia. Nenhum score biométrico interno é exposto ao colaborador.

## Estados visuais

- **Aguardando:** orienta o posicionamento sem poluir a imagem.
- **Confirmando:** mostra quantas pessoas do grupo já foram registradas e chama quem ainda vai chegar.
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
- `web/src/pages/terminalFaceMemory.ts`: memória curta dos rostos já tratados e espera entre tentativas;
- `web/src/components/CameraCapture.tsx`: câmera, rastreamento local e recortes;
- `api/app/services/attendance.py` e `api/app/api/v1/routes/attendance.py`: decisão do ponto e lote em grupo;
- `web/src/components/Layout.tsx`: navegação responsiva;
- `web/src/styles.css`: sistema visual, estados e responsividade;
- `web/src/services/api.ts`: cancelamento de requisições de reconhecimento.
