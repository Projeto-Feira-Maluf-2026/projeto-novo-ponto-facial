# Diagramas

## Contexto

```mermaid
flowchart LR
  Funcionario[Funcionario] --> Mobile[App Flutter]
  Supervisor[Supervisor] --> Web[Painel Web]
  Tablet[Tablet/Totem] --> API[FastAPI]
  Mobile --> API
  Web --> API
  API --> PG[(PostgreSQL)]
  API --> Redis[(Redis)]
  API --> AI[InsightFace ArcFace ONNX]
  API --> Reports[PDF Excel CSV]
```

## Fluxo antifraude

```mermaid
sequenceDiagram
  participant D as Dispositivo
  participant A as API FastAPI
  participant Q as Validacao/qualidade
  participant F as Face Matcher
  participant G as Geofence
  participant DB as PostgreSQL

  D->>A: imagem + contexto
  A->>Q: MIME + pixels + deteccao + qualidade
  Q-->>A: relatorio estruturado
  A->>F: deteccao + alinhamento + embedding
  F-->>A: funcionario + similaridade
  A->>G: coordenadas + obra
  G-->>A: dentro/fora do raio
  A->>DB: attendance_records ou suspicious_attempts
  A-->>D: decisao + score
```

O diagrama ainda não inclui liveness porque challenge-response temporal e PAD não estão
implementados. O endpoint legado de ponto será substituído pelo fluxo de sessão na Sprint 3.

## Entidades principais

```mermaid
erDiagram
  employees ||--o{ employee_worksites : vinculado
  worksites ||--o{ employee_worksites : possui
  worksites ||--o{ capture_devices : possui
  employees ||--o{ face_templates : cadastra
  employees ||--o{ attendance_records : registra
  worksites ||--o{ attendance_records : recebe
  capture_devices ||--o{ attendance_records : captura
  employees ||--o{ suspicious_attempts : suspeita
  users ||--o{ refresh_tokens : autentica
```
