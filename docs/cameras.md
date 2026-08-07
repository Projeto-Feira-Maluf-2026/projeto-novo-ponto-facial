# Cameras e CFTV

## Tipos suportados

- Webcam local.
- RTSP.
- Camera IP generica.
- DVR/NVR por canal RTSP.
- ONVIF como cadastro operacional.
- Intelbras, Hikvision e Dahua via URL RTSP.

## Fluxo recomendado

1. Cadastre ou selecione uma obra.
2. Abra **Cameras de seguranca**.
3. Escolha o tipo da camera.
4. Preencha IP, porta, usuario/senha ou URL RTSP.
5. Clique em **Testar camera**.
6. Salve a camera.
7. Use o icone de olho para abrir o preview limpo.

## URLs RTSP comuns

Intelbras/Dahua:

```text
rtsp://usuario:senha@IP:554/cam/realmonitor?channel=1&subtype=0
```

Hikvision:

```text
rtsp://usuario:senha@IP:554/Streaming/Channels/101
```

Generica:

```text
rtsp://usuario:senha@IP:554/
```

## Como o preview funciona

Browsers nao reproduzem RTSP nativamente. A API usa OpenCV para abrir a camera e entregar imagem JPEG autenticada para o painel. Isso permite testar cameras comuns de seguranca sem instalar plugin no navegador.

## Reconhecimento com camera distante ou de baixa qualidade

O terminal usa um pipeline em camadas para nao depender de uma unica tentativa:

1. solicita 1280 x 720 e 30 FPS quando a webcam suporta;
2. analisa a imagem completa em tres escalas (`320`, `640` e `1280`);
3. se o primeiro quadro falhar por distancia ou baixa confianca, usa a caixa localizada
   pelo navegador ou pelo detector real do servidor, recorta o rosto, amplia a regiao
   com interpolacao de alta qualidade e repete;
4. no servidor, quadros escuros, com pouco contraste ou levemente desfocados recebem
   ate duas variantes conservadoras com CLAHE, ajuste de luminancia e nitidez;
5. o ponto automatico so confirma depois de tres leituras consecutivas da mesma pessoa.

O cadastro usa um piso de area facial um pouco mais tolerante (`0.012` da imagem), mas
continua exigindo apenas uma pessoa, landmarks, pose, diversidade e consistencia entre
as cinco capturas. Candidatos muito fracos gerados pelo detector sao ignorados; uma
segunda face com confianca comparavel continua bloqueando a operacao.

Essa estrategia melhora a recuperacao de rostos pequenos, mas nao substitui a validacao
no local. Antes da implantacao, colete pelo menos 30–50 amostras anonimizadas nas
distancias e iluminacoes reais para calibrar similaridade, qualidade, margem e latencia.

## Problemas comuns

- Verifique se o computador consegue acessar o IP da camera.
- Confirme usuario e senha.
- Confirme se RTSP esta habilitado no DVR/NVR.
- Teste primeiro o stream principal, depois o stream secundario se a rede estiver lenta.
- Em cameras com firewall, libere a porta RTSP, geralmente `554`.
- Para reconhecimento facial, prefira o stream principal e evite compressao agressiva.
- Posicione a camera perto da altura dos olhos e evite uma janela forte atras da pessoa.
