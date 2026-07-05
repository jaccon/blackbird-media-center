# BlackBird Media Center (sgixMediaCenter / Pitchu)

O **BlackBird Media Center** é um Media Center moderno, leve, rápido e amigável construído em Node.js (Express) com suporte a transcodificação dinâmica, transmissão de câmeras de segurança RTSP, área de arquivos oculta protegida por senha, upload robusto de arquivos grandes e controle remoto integrado via WebSockets.

---

## 🚀 Requisitos e Dependências

Para rodar a aplicação em seu ambiente, você só precisa de:
* **Docker** instalado.
* **Docker Compose** instalado.

Todas as dependências internas do projeto (como Node.js 18, FFmpeg, FFprobe e dependências de pacotes do npm) já vêm pré-configuradas e empacotadas dentro do container oficial do Docker.

---

## 🐳 Instalação e Execução via Docker

A execução do Media Center é totalmente conteinerizada para evitar configurações manuais e conflitos de dependências no seu sistema hospedeiro.

### 1. Configurando o `docker-compose.yml`
Antes de iniciar, você pode abrir e editar o arquivo `docker-compose.yml` na raiz para ajustar os parâmetros de rede e portas:

* **Portas**: Por padrão, o Media Center escuta na porta `5555`. Você pode mapear para outra porta alterando a seção `ports` (ex: `"8080:5555"` para escutar na porta 8080 do host).
* **Diretório Compartilhado**: A pasta de mídias fica mapeada em `./src` no host para `/usr/src/app` no container. Você pode colocar seus arquivos de mídia diretamente em `src/public/shared/` para que fiquem visíveis no Explorer da aplicação.

### 2. Iniciando o Servidor
Para subir o container em segundo plano (modo daemon) com todas as redes e volumes configurados, execute o script auxiliar:

```bash
bash start.sh
```

*(Alternativamente, você pode rodar o comando direto do Compose: `docker-compose --project-name="blackbirdmc" up -d`)*

No primeiro boot, o Docker irá baixar a imagem base do Node 18, rodar `npm install` para instalar as dependências de mídia e iniciar o servidor.

### 3. Acessando a Aplicação
Uma vez iniciado, abra seu navegador de preferência e acesse:
* **Acesso Local**: `http://localhost:5555`
* **Acesso na Rede Local (Wi-Fi/Ethernet)**: `http://<IP_DO_SEU_COMPUTADOR>:5555`
*(O endereço IP do computador na rede local é detectado e exibido nos logs de inicialização do console da aplicação)*

### 4. Parando o Servidor
Para desligar o container de forma limpa e liberar as portas e redes alocadas, utilize o script auxiliar:

```bash
bash stop.sh
```

*(Alternativamente: `docker-compose --project-name="blackbirdmc" down`)*

---

## 📡 Rede e Configuração Interna do Docker

O arquivo `docker-compose.yml` vem configurado com uma rede do tipo bridge chamada `hosting` com as seguintes definições:
* **Subrede**: `172.16.155.0/24`
* **Gateway**: `172.16.155.1`

Essa subrede isola a comunicação WebSocket e de streaming de vídeo das demais portas do seu computador, garantindo conexões rápidas do player e do controle remoto de forma segura.

---

## 📂 Documentação Detalhada do Projeto

Para ajudar desenvolvedores e agentes de IA a trabalhar com a base de código da aplicação de forma padronizada, disponibilizamos documentações aprofundadas na pasta `documentations/`:

* **[Arquitetura do BlackBird Media Center](file:///Users/jaccon/Documents/Lab/BlackBird%20MC/v2/app/documentations/arquitetura.md)** (`documentations/arquitetura.md`) — Detalha a stack tecnológica (Express, EJS, WebSockets, Bootstrap 5), o armazenamento em arquivos JSON no `datacache/` e o pipeline de transcodificação em tempo real com FFmpeg.
* **[Documentação Agêntica](file:///Users/jaccon/Documents/Lab/BlackBird%20MC/v2/app/documentations/agentica.md)** (`documentations/agentica.md`) — Explica como delegar tarefas para agentes autônomos (como Amelia, Winston, John e Sally) baseados no BMAD Method e como usar o *Party Mode*.
* **[Skills para Desenvolvimento](file:///Users/jaccon/Documents/Lab/BlackBird%20MC/v2/app/documentations/skills.md)** (`documentations/skills.md`) — Um manual de instruções detalhando quais skills acionar para modificações de backend, estilização de visual, manipulação do FFmpeg ou automação de testes.

