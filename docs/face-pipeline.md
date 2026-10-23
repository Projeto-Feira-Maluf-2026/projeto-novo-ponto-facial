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
