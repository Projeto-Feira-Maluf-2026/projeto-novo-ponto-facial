# Seguranca e LGPD

## Controles implementados

- JWT de curta duracao.
- Refresh token rotativo persistido por hash.
- RBAC por cargo com escopos.
- Hash de senhas com bcrypt e pepper.
- Criptografia de campos sensiveis com Fernet.
- Estrutura de auditoria existente; cobertura completa de ações críticas ainda pendente.
- Validacao de entrada via Pydantic.
- SQL Injection mitigado por SQLAlchemy parametrizado.
- XSS mitigado no frontend por React e ausencia de HTML bruto.
- CSRF reduzido porque a API usa Bearer token em Authorization, nao cookie de sessao.
- Pipeline facial limitado por bytes, MIME real, dimensões e pixels; upload de foto de
  perfil ainda requer o mesmo endurecimento.
- Logs de tentativas suspeitas.

## LGPD

- Biometria facial e dado pessoal sensivel.
- O cadastro possui campo `consent_biometric_at` para registrar consentimento.
- Templates faciais sao armazenados como embeddings, nao como imagem bruta obrigatoria.
- Documentos e telefones ficam criptografados.
- Acesso aos dados e controlado por perfil.
- Auditoria permite rastrear consultas, alteracoes e exportacoes.
- Implantacao real deve definir politica de retencao, base legal, termo de consentimento, RIPD e canal de atendimento ao titular.

## Antifraude — estado atual

- Bloqueio por multiplos rostos.
- Não há PAD passivo validado nem challenge-response temporal nesta sprint.
- Pose, movimento de dois frames e qualidade não são tratados como liveness.
- O endpoint de ponto legado ainda aceita sinais do cliente e deve permanecer fora de
  produção até a Sprint 3.
- Similaridade minima ArcFace.
- Geofence por obra.
- Registro de tentativa suspeita com severidade.
- Existe status `MANUAL_REVIEW`, mas a fila/resolução auditável ainda não está completa.

## Observacao sobre modelos

Antes de producao, valide licenciamento comercial dos modelos pre-treinados de reconhecimento facial escolhidos. A arquitetura permite trocar o provider de IA sem alterar as regras de negocio.
