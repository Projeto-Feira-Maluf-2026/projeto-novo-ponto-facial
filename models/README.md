# Modelos faciais locais

Este diretorio nao armazena binarios no Git. Para o Docker local, copie ou monte a
estrutura do InsightFace sob `models/`, por exemplo:

```text
models/
  models/
    buffalo_l/
      det_10g.onnx
      w600k_r50.onnx
```

Como alternativa, defina `FACE_MODEL_HOST_PATH` para o diretorio que contem a pasta
`models/buffalo_l`. O provider nao baixa modelos automaticamente e o readiness fica
indisponivel quando o pacote ou o checksum configurado nao puder ser verificado.
