# Recuperação da webcam

Diagnóstico: P1 — o terminal repetia o modo de captura que falhou e o fallback
genérico podia selecionar novamente a mesma câmera indisponível. A lista de
dispositivos só aparecia após uma abertura bem-sucedida. P2 — o rodapé continuava
mostrando “Iniciando a câmera” quando a captura já havia falhado. A imagem enviada
não comprova uso por outro aplicativo; erro de driver ou dispositivo virtual também
pode impedir a abertura.

Correção incremental: preferir 720p, aceitar o modo nativo sem limites obrigatórios
de FPS/resolução, tentar entradas autorizadas alternativas, disponibilizar o seletor
na falha, limitar a duas reconexões automáticas e propagar a mensagem ao terminal.
A captura não reaplica a resolução máxima anunciada pelo driver. Uma abertura que
termina depois da navegação libera suas tracks e não inicia novas tentativas.
Permissão negada encerra a operação sem tentar outros dispositivos.

Validação: testes sintéticos de modo incompatível, câmera virtual indisponível,
dispositivo salvo removido, permissão negada, navegação durante abertura, limite de
tentativas e recuperação pelo seletor. Nenhuma imagem biométrica real foi coletada.
O funcionamento da webcam física deve ser confirmado no navegador do operador.

Operação: recarregar o terminal após o deploy; selecionar a webcam física quando
houver câmera virtual configurada. Se todos os dispositivos continuarem falhando,
verificar permissões de câmera no navegador/Windows e processos que a utilizam.
As permissões do navegador continuam obrigatórias.

Rollback: reverter o commit da correção ou restaurar o deployment web anterior
824178f na Vercel. A API facial e o banco não precisam de alteração.

Riscos existentes: o lockfile de produção acusa 5 vulnerabilidades moderadas e 9
altas; a atualização está preparada na auditoria separada (PR #1), cujo rollout
depende de validações de infraestrutura/biometria. Este ajuste de câmera não resolve
esses riscos e não representa homologação de segurança ou reconhecimento facial.
