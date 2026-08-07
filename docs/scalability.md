# Estrategias de escalabilidade

## API

- Escalar FastAPI horizontalmente atras de load balancer.
- Manter API stateless usando JWT e Redis.
- Usar pool de conexoes PostgreSQL.
- Separar endpoints pesados de relatorio em workers.

## IA

- Isolar inferencia facial em workers dedicados com CPU/GPU.
- Cachear embeddings ativos em Redis ou memoria por replica.
- Versionar modelos e templates por `model_name` e `model_version`.
- Reprocessar templates ao trocar modelo de reconhecimento.

## Banco

- Indices por funcionario/data e obra/data.
- Particionar `attendance_records` por mes quando passar de milhoes de linhas.
- Arquivar registros antigos em storage frio mantendo metadados consultaveis.
- Usar replicas de leitura para dashboard e relatorios.

## Mobile/offline

- Cada registro offline recebe `offline_batch_id`.
- A API deve rejeitar duplicidades por dispositivo, funcionario e janela de tempo.
- Sincronizacao prioriza ordem cronologica.
- Falhas permanentes viram revisao manual.

## Tempo real

- Redis pub/sub ou WebSocket para dashboard.
- Agregados do dia podem ficar em cache por 10 a 30 segundos.
- Alertas antifraude devem ser publicados imediatamente para gestores.

