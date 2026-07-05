# Arquitetura do BlackBird Media Center (sgixMediaCenter)

Este documento detalha a arquitetura técnica da aplicação contida no diretório `src/`, um Media Center rápido, leve e amigável (conhecido comercialmente como **BlackBird Media Center**, **sgixMediaCenter** ou **Pitchu**).

---

## 🛠️ Stack Tecnológica

A aplicação é construída sobre uma arquitetura Node.js monolítica, utilizando Express.js e comunicação em tempo real via WebSockets:

* **Backend**: Node.js & Express.js (servidor HTTP).
* **Frontend**: EJS (Embedded JavaScript) para renderização no lado do servidor, estilizado com Bootstrap 5.
* **Transcodificação e Mídia**: FFmpeg & FFprobe (geridos programaticamente através do `fluent-ffmpeg` com binários estáticos providos por `ffmpeg-static` e `@ffprobe-installer/ffprobe`).
* **Banco de Dados**: Armazenamento simples orientado a arquivos em formato JSON (sob `src/datacache/`).
* **Comunicação em Tempo Real**: Protocolo WebSocket (`ws`) para gerenciamento do controle remoto e sincronização de status de transcodificação.
* **Upload de Arquivos**: Multer integrado com manipulação de chunks (`fs-extra`) para upload de grandes arquivos de mídia de forma estável.

---

## 📂 Arquitetura de Pastas e Componentes

A estrutura principal do código em `src/` está organizada da seguinte forma:

```
src/
├── datacache/                  # Bancos de dados JSON locais
│   ├── config.json             # Configurações globais (idioma, autenticação, etc)
│   ├── cameras.json            # Câmeras de segurança RTSP cadastradas
│   ├── favorites.json          # Mídias favoritadas pelo usuário
│   ├── history.json            # Histórico de reprodução recente
│   ├── hidden_files.json       # Lista de caminhos de arquivos bloqueados/ocultados
│   └── password.json           # Senha criptografada da área oculta
├── public/                     # Arquivos estáticos servidos diretamente
│   ├── css/                    # Folhas de estilo (inclui Bootstrap)
│   ├── js/                     # Scripts do cliente (WebSocket do player, remote, etc)
│   ├── images/                 # Imagens de interface
│   └── shared/                 # Pasta de mídias compartilhadas do usuário
├── views/                      # Arquivos de visualização EJS
│   ├── dashboard.ejs           # Painel de controle principal
│   ├── explorer.ejs            # Gerenciador de arquivos (Explorer)
│   ├── play.ejs                # Player de vídeo/áudio web integrado
│   ├── remote.ejs              # Interface de controle remoto do player
│   └── cameras.ejs             # Interface de visualização de streams RTSP
├── server.js                   # O cérebro do servidor (rotas, ffmpeg, websockets)
└── package.json                # Gerenciador de dependências do Node.js
```

---

## ⚙️ Principais Mecanismos Técnicos

### 1. Transcodificação Dinâmica e Streaming (HLS & Direct)
Para reproduzir arquivos pesados que os navegadores não suportam nativamente (como `.mkv` ou `.avi`), a aplicação usa um pipeline FFmpeg:
* **HLS (HTTP Live Streaming)**: Cria arquivos de índice `.m3u8` e segmentos de vídeo `.ts` dinamicamente na pasta temporária, permitindo reprodução adaptativa.
* **Otimização de Vídeo**: Transcodifica arquivos pesados para MP4 (`H.264 / AAC`) de forma assíncrona, salvando o progresso no WebSocket para atualizar o usuário em tempo real.
* **Extração de Legendas**: Converte legendas internas do formato SRT ou ASS para WebVTT (.vtt) compatível com a tag `<track>` do HTML5.

### 2. Hub de Câmeras RTSP
A aplicação atua como um proxy de streaming para câmeras IP de protocolo RTSP:
* Recebe a URL RTSP configurada (`rtsp://...`).
* Executa o FFmpeg em background para retransmitir o vídeo bruto do feed da câmera e convertê-lo em fluxos HLS web de baixíssima latência ou snapshots periódicos exibidos em `views/cameras.ejs`.

### 3. Banco de Dados Baseado em Arquivos JSON (`src/datacache/`)
Em vez de depender de um servidor de banco de dados pesado (MySQL/PostgreSQL), o BlackBird Media Center usa a biblioteca `fs-extra` para ler e gravar arquivos JSON de forma atômica na pasta `datacache/`.
* No boot (`server.js`), o servidor roda funções de migração (`migrateToDatacache`) que garantem que arquivos legados criados na raiz sejam movidos de forma segura para a pasta isolada.
* Controles simples de concorrência de leitura e escrita síncronas/assíncronas garantem a integridade das listas de favoritos e histórico.

### 4. Controle Remoto WebSocket (`/remote`)
Utilizando o pacote `ws`, a aplicação implementa uma arquitetura Pub/Sub simples:
* O dispositivo player (ex: uma Smart TV rodando `/play`) conecta-se ao WebSocket.
* O dispositivo controlador (ex: um smartphone rodando `/remote`) envia comandos de controle (Play, Pause, Volume, Seek, Avançar Canal).
* O servidor Express repassa os eventos instantaneamente para a sessão do player correto via WebSocket.

### 5. Área Oculta (Hidden Area)
A aplicação possui um recurso para ocultar mídias específicas:
* O usuário marca um arquivo ou diretório como oculto.
* O servidor registra o caminho relativo no banco `hidden_files.json`.
* Essas mídias são omitidas das listagens do explorer e galerias até que o usuário se autentique em `/hidden-area` fornecendo a senha cadastrada no `password.json`.
