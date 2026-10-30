# Pipeline facial de produção

## Decisão técnica

O sistema usa InsightFace/ArcFace com embeddings normalizados de 512 dimensões. Cadastro
e reconhecimento compartilham o mesmo detector, alinhamento, modelo, versão e
normalização. Templates incompatíveis são ignorados e uma troca de modelo exige
recadastro explícito.

## Cadastro automático

Cada frame é analisado isoladamente. Frames escuros, desfocados, pequenos, duplicados ou
inconsistentes geram orientação, mas não apagam amostras anteriores. Amostras aceitas são
armazenadas como templates provisórios inativos, permitindo que diferentes instâncias do
container continuem a mesma sessão. A seleção final prioriza qualidade e diversidade de
yaw/pitch sem impor uma coreografia rígida.

Somente depois de cinco embeddings coerentes o sistema desativa os templates anteriores e
ativa o novo conjunto na mesma transação. A imagem não é persistida no banco; são mantidos
embedding, hash, métricas de qualidade, pose, versão do modelo e horário.

## Reconhecimento em vídeo

O frontend mantém uma janela temporal de quatro segundos com estados `UNKNOWN`,
`POSSIBLE`, `CONFIRMING` e `CONFIRMED`. Na confirmação, três frames são enviados juntos.
O servidor reprocessa os frames, exige evidência utilizável, verifica a similaridade entre
os embeddings e cria um vetor de consulta agregado por qualidade.

Cada identidade é comparada contra até cinco templates por centróide ponderado e mediana
dos melhores scores. A decisão também exige margem sobre o segundo candidato; um falso
positivo é tratado como pior que aguardar um novo frame.

## Distância, luz e desempenho

O detector começa nas escalas 320/640 e aciona 1280 apenas quando não encontra rosto ou
quando a área facial é pequena. Em baixa luz, CLAHE e correção de luminância servem apenas
para localizar o rosto; o embedding é sempre extraído de pixels originais recortados e
alinhados. O rastreador visual do navegador é limitado a aproximadamente 11 FPS e pausa em
aba oculta.

Não existe recuperação de detalhe inexistente. Se o rosto tiver poucos pixels, estiver
oculto, com forte borrão de movimento ou iluminação saturada, o sistema orienta aproximação
ou correção em vez de reduzir o limiar de identidade.

## Referências comparadas

- Viniciusrz7/Reconhecimento-Facial: separação entre serviço e interface, loop contínuo e
  feedback imediato foram preservados; OpenFace 128-D, threshold fixo e `HashMap` em memória
  não são adequados ao uso real.
- gist dantetesta: múltiplos descritores e overlay alinhado ao vídeo foram aproveitados como
  princípios; inferência de identidade no cliente e decisão por frame foram rejeitadas.
- david-luk4s/reconhecimento-facial: coleta de várias imagens e etapa separada de treino
  inspiram a diversidade; Haar/Eigen/Fisher/LBPH, arquivos locais e retreinamento global são
  substituídos por detector moderno e templates ArcFace persistentes.

## Limitações honestas

- PAD/liveness ainda não está disponível; consistência temporal não é prova de vida.
- thresholds precisam de calibração por câmera e população antes de homologação.
- 1280 aumenta alcance, mas também latência; o passe é adaptativo e deve ser medido no
  hardware de produção.
- câmeras muito distantes precisam de lente, resolução e instalação adequadas; software não
  recompõe informação facial ausente.

## Desempenho do caminho da batida (22/10/2026)

- O detector roda sozinho em cada passada de resolução; o ArcFace (etapa mais cara) roda uma única vez, só para o rosto escolhido. Leituras com mais de um rosto confiável são recusadas sem calcular embedding.
- Quadros realçados (CLAHE) servem apenas para localizar o rosto e usam detecção sem embedding. Eles não são mais gerados quando o único problema é blur, exposição ou contraste, porque essas medidas vêm dos pixels originais e não mudariam.
- Templates ativos ficam em memória por 30 s por obra, e o recadastro facial invalida o cache.
- Em grupo, todas as batidas entram em uma transação e um commit. O e-mail sai em segundo plano, depois da resposta ao terminal.
- O container facial mantém um pool pequeno de conexões com o Postgres em vez de abrir uma conexão por leitura.
- Tentativas rejeitadas idênticas (mesma obra e motivo) são gravadas no máximo uma vez a cada 8 s.

## Rostos próximos e fora do centro (30/10/2026)

- O terminal recorta um quadrado sempre centrado no rosto. Quando o quadrado passa da borda do vídeo, a sobra é preenchida com cinza neutro em vez de empurrar o recorte para dentro. Antes, quem estava perto da câmera ou na lateral chegava ao servidor descentralizado e encostado na borda da imagem (`FACE_OFF_CENTER` / `FACE_OUT_OF_FRAME`) e era recusado em toda leitura.
- O detector não usa escalas maiores que a própria imagem: um recorte de 384–576 px para em 640 e não roda a passada de 1280, que só ampliava pixels. Leitura sem rosto num recorte de 576 px caiu de ~1,9 s para ~0,6 s em CPU.
- Na batida de ponto, `FACE_OFF_CENTER` deixou de impedir a comparação: a posição no quadro não muda o embedding alinhado pelos cinco pontos. `FACE_OUT_OF_FRAME` continua bloqueando.
