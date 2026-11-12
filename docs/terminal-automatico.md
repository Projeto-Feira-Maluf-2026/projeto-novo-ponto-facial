# Terminal automático de ponto

## Objetivo

A tela `Ponto automático` foi desenhada para funcionar em uma câmera fixa, sem seleção manual de funcionário, tipo de ponto ou botão de confirmação. O colaborador se aproxima, olha para a câmera e recebe uma resposta visual imediata.

## Fluxo de operação (atualizado em 12/11/2026, depois da feira)

1. O terminal inicia a câmera e seleciona a obra vinculada.
2. O MediaPipe, no próprio navegador, acompanha até cinco rostos a cada quadro. Nada vai ao servidor enquanto ninguém novo aparece.
3. Quando surge um rosto que ainda não foi tratado, o terminal tira uma foto só desse rosto (recorte de 384 a 576 px) e envia um rosto por pedido em `POST /attendance/punch/batch`. Cada pessoa aparece na tela assim que é reconhecida; a próxima vai logo em seguida. A fila prioriza quem ainda não foi tentado e, entre esses, o rosto maior (mais perto).
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

## Modo feira (notebook, 12/11/2026)

`powershell -ExecutionPolicy Bypass -File scripts/feira-local.ps1` roda a API facial e o site no
próprio notebook (só o banco continua no Supabase). Sem ida e volta à nuvem e sem container frio.
O script tenta a GPU integrada via `onnxruntime-directml`, mede CPU x GPU com
`scripts/benchmark_face_runtime.py` e fica com o mais rápido; se a GPU falhar, segue na CPU.
`-SemGpu` pula a tentativa. `npm run setup` restaura o onnxruntime de CPU.

Quadra aberta: o terminal ignora rostos com menos de 6,5% da altura do vídeo
(`MIN_READABLE_FACE_HEIGHT`, ~3,5 a 4 m numa webcam comum, com a câmera em 1080p). Quem passa mais
ao fundo não é lido nem segura o grupo da apresentação. O detector de rostos distantes alterna entre
o quadro inteiro e a faixa central (`web/src/components/distantFaceTiles.ts`), onde um rosto distante
chega ~1,7x maior ao modelo.

Contraluz (sol atrás das pessoas): quando o rosto fica abaixo de 30% de luminância, a prévia da
câmera é mostrada clareada, com o aviso "Contraluz", e o terminal pede à câmera mais exposição (se o
driver permitir).
No servidor, um rosto com mediana abaixo de 35% recebe ganho em luz linear antes da detecção e do
embedding (`exposure_corrected_face` em `api/app/services/ai/facial_service.py`). Em rostos reais
escurecidos por contraluz sintético, isso levou de 1 para 6 de 6 rostos lidos, com a similaridade
de impostores abaixo de 0,21 (limiar de aceite 0,62).

## Antifraude: foto ou vídeo mostrado à câmera (12/11/2026)

Na feira, uma foto de rosto mostrada na tela de um celular registrou o ponto. Agora cada foto que
chega ao servidor passa por dois modelos MiniFASNet (V2 e V1SE, ONNX, ~1,7 MB cada,
`api/app/services/ai/minifasnet_pad.py`) sobre os pixels originais, antes da comparação de
identidade. A média da probabilidade de "rosto ao vivo" abaixo de `FACE_PAD_MIN_LIVE_SCORE` (0,30)
marca a batida como suspeita (`presentation_attack_suspected`) e registra a tentativa suspeita.

Por padrão (`FACE_PAD_ACTION=review`) a suspeita não barra ninguém: se o rosto for reconhecido, o
ponto entra "Em conferência" (`MANUAL_REVIEW`, `pad_suspected` nos metadados) para a equipe revisar.
Com `FACE_PAD_ACTION=block` a batida é recusada e o terminal mostra "Parece uma foto ou uma tela".

O modo revisão veio do teste com 1000 fotos de grupo (relatório em
`relatorios/teste-extremo-1000-fotos.md` nos arquivos do projeto): por quadro, o modelo aprova 86%
dos rostos reais sozinhos, mas só 60% dos rostos reais em recorte de grupo, e ainda aprova 15 a 17%
das fotos falsas simuladas. Como bloqueio ele travaria a fila; como alerta ele ajuda.

Medido em 6 rostos reais: rosto ao vivo 0,53 a 0,99 (também em contraluz), rosto num celular
simulado 0,00 a 0,21 e foto em papel simulada 0,00 a 0,05; ~10 ms por rosto na CPU.

- Imagem da API no Vercel: os modelos são baixados no build e conferidos por SHA-256.
- Modo local/feira: baixados na primeira inicialização para `~/.insightface/models/minifasnet`
  (tempo limite de 20 s). Sem internet ou com arquivo corrompido, o ponto segue sem antifraude fora
  de staging/produção, em vez de parar; em staging/produção a batida fecha com `PAD_UNAVAILABLE`.
- `FACE_PAD_MIN_LIVE_SCORE` muda o corte da suspeita; `FACE_PAD_ENABLED=false` desliga a
  antifraude fora de staging/produção.
