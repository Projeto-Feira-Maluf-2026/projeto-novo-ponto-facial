# Cliente mobile: protótipo, sem homologação

O botão de ponto não envia embeddings sintéticos nem inventa aceitação. Login,
captura real, PAD e vínculo de dispositivo ainda precisam implementação de produto.
As telas de histórico/horas/avisos contêm dados demonstrativos identificados na UI.

Fila nova: armazenamento Flutter Secure Storage 10.0.0 (compatível com Dart 3.4),
mutex dentro do isolate entre instâncias, vínculo por usuário da sessão, idempotência
estável, checkpoint de ACK, retenção máxima de 24 horas ao sincronizar e 50 itens
de até 512 KiB. Retenção local não autoriza ponto retroativo; a API decide.
Rejeição/timeout/401/403 não remove o item nem confirma aceitação. Troca de sessão
interrompe sync; sync de outro usuário não lê a fila anterior. A fila não deve ser
usada de outro isolate: o mutex não coordena processos/isolate separados.

Fila antiga SharedPreferences: sem dono verificável, bloqueia envio/migração
automática. Antes de habilitar o app real, oferecer revisão/exclusão local explícita
com informação ao operador; nunca atribuir silenciosamente esses itens ao login atual.

Transporte: HTTPS obrigatório; HTTP em loopback/emulador somente por
`allowInsecureLocal: true` explícito. Requests têm timeout de 15 segundos.
Aceitação exige `record.id` e timestamp persistidos retornados pelo servidor.

Antes de build Android, implementar o projeto nativo (ausente neste checkout),
Android SDK >=23 e `android:allowBackup="false"`/exclusões conforme secure-storage;
validar KeyStore, migração, reinstalação, perda de chave e tela bloqueada em aparelho.
iOS requer validação de Keychain/entitlements. Não persistir tokens na fila.

Com Flutter/Dart instalado: `flutter pub get`, gerar/revisar e versionar
`pubspec.lock`, `flutter analyze`, `flutter test`. Esta máquina não tinha SDK:
os seis testes de fila foram escritos mas **não executados**; não há claim de build
mobile validado. Package novo foi consultado no registry oficial e fixado sem
inventar lock resolvido.

Fonte: [Flutter Secure Storage](https://pub.dev/packages/flutter_secure_storage/versions/10.0.0).
