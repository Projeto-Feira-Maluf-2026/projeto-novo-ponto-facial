# Câmera, matching e limite PAD — validação local

## Implementação e fronteiras

`faceTracking.worker.ts` executa FaceLandmarker e detector distante em Worker;
o main thread continua responsável por câmera, desenho das caixas e interação.
Um único ImageBitmap fica pendente; frames intermediários são descartados,
sem fila crescente. Bitmap é fechado no Worker ou após cancelamento antes da
transferência. Desmontagem/erro encerra o Worker; inicialização tem limite de
30 s e resposta de frame 10 s. Não há fallback MediaPipe síncrono escondido.
O fallback nativo do navegador existente continua disponível quando suportado.

Modelos e thresholds MediaPipe foram preservados. Worker utiliza CPU, enquanto
o código anterior tentava GPU e depois CPU. Isso remove a inferência síncrona
da UI, mas **não comprova FPS ou latência melhores**, especialmente em máquinas
com GPU. Validar webcam física, Worker/CSP/WebAssembly, consumo, FPS e p95 nos
dispositivos reais antes de homologar. Resultados locais não são enviados por
este Worker e não são persistidos.

Status da câmera e terminal são anunciados por região `status` atômica,
prévia possui descrição acessível e controles de pausa/tela cheia expõem
`aria-pressed`. Isso não substitui inspeção com leitor de tela e teclado real.

Matching normaliza e pontua em blocos de até 256 identidades, com centróides
ponderados calculados em lote. Mantém filtro de qualidade, limite de templates,
top K, pesos, thresholds e ordenação estável em empate. Matrizes transitórias
ficam limitadas pelo bloco e pelo limite configurado de templates. Normalização
float64 evita overflow de norma inclusive em vetores finitos float32 extremos.
Não foi criado cache global nem índice ANN entre tenants.

## PAD não disponível

`presentation_attack.py` fornece contrato interno de provider. A factory atual
retorna `UnavailablePresentationAttackProvider`: nenhum modelo PAD validado foi
fornecido. `evaluate_presentation_attack(images)` nunca aceita no estado atual;
ausência, exceção, NaN/Inf, score fora de [0,1], falta de avaliação ou versão
falham fechados. Injeção de adapter é somente interna para integração/testes,
nunca uma decisão recebida do cliente. O adapter futuro precisa consumir imagens
decodificadas pelo servidor e protocolo autorizado de avaliação.

Um challenge de uso único ajuda a controlar replay de requisição; não comprova
presença viva nem bloqueia fotografia, vídeo ou injeção por si só. Landmarks,
movimento e piscada não são declarados PAD. A instalação de um modelo, sua
licença e calibração por cenário permanecem gates externos.

## Evidências

- 28 testes matching/PAD passaram, incluindo 259 identidades cruzando o bloco
  e referência escalar independente com `math.fsum`, tolerância absoluta 1e-7,
  vetores float32 extremos, provider ausente, falha e evidência inválida.
- 58 testes web passaram; teste novo prova backpressure de um frame e descarte
  de bitmap concluído após desmontagem. Typecheck e build passaram. Chunk
  Three.js de 514,21 kB conserva aviso preexistente.
- Ruff nos arquivos IA/testes/scripts passou.

Benchmark sintético: seed 20261010, 512 dimensões, cinco templates por identidade,
21 repetições, mesmo processo, mediana em ms. Sem rostos, banco, rede ou modelos.

| Identidades | Git 824178f | Vetorizado | Diferença |
|---|---:|---:|---:|
| 100 | 8,673 | 7,252 | -16,4% |
| 1.000 | 86,556 | 82,970 | -4,1% |

Uma comparação separada com referência escalar que incorpora as validações atuais
mediu 12,316 → 7,817 ms (100) e 122,744 → 83,554 ms (1.000). As execuções variam
com carga/cache; não usar os percentuais como promessa de latência operacional.
Mesma ordem sintética, desvio máximo de score 1,70e-8; tolerância numérica não
equivale a precisão biométrica. Não houve calibração nem alteração de thresholds.

Reprodução em PowerShell no checkout:

```powershell
$env:PYTHONPATH = 'api'
api/.venv-audit/Scripts/python.exe scripts/benchmark_face_matching.py --baseline 824178f --repeats 21
api/.venv-audit/Scripts/python.exe scripts/benchmark_face_matching.py --baseline-file scripts/reference_face_matching.py --repeats 21
```

## Fontes primárias

[Google MediaPipe Face Landmarker Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
documenta o bloqueio síncrono e recomenda Worker.
[MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
documenta a cópia de frame compatível com transferência.
[NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
e [NIST FATE PAD](https://www.nist.gov/publications/face-analysis-technology-evaluation-fate-part-10-performance-passive-software-based)
orientam avaliação de ataques; não constituem certificação desta aplicação.

## Reversão e limites

Reverter só o conjunto Worker/câmera ou matching correspondente e repetir checks;
não reverter as proteções numéricas/autorização anteriores. Sem deploy, migration
ou processamento de biometria real. Falta homologação de hardware/modelos,
protocolos PAD/FMR/FNMR, iluminacão/populações, CSP/CDN e câmera física.

