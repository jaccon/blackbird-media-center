# Documentação Agêntica (Desenvolvimento com Agentes de IA)

Este documento orienta os **Agentes de IA** (e desenvolvedores humanos que utilizam agentes como o *Google Antigravity*, *Claude Code* ou *Cursor*) sobre como colaborar com o ecossistema do **BlackBird Media Center**.

---

## 🤖 Papéis Agênticos Aplicados ao BlackBird Media Center

Ao desenvolver novas funcionalidades para este Media Center, cada agente do **BMAD Method** possui uma perspectiva e responsabilidade específicas sobre a arquitetura e arquivos de `src/`:

### 1. John (Product Manager — `bmad-agent-pm`)
* **Foco**: Definir casos de uso de mídia, experiência de reprodução e facilidade de compartilhamento de arquivos.
* **Ações Comuns**: Refinar histórias para compatibilidade de legendas, gerenciar o escopo de segurança da Área Oculta (`/hidden-area`) e alinhar as traduções nos idiomas (EN, PT, ES) declarados em `server.js`.
* **Entrega**: Atualização e validação dos critérios de aceitação no PRD.

### 2. Winston (System Architect — `bmad-agent-architect`)
* **Foco**: Estabilidade do pipeline de transcoding, controle de concorrência no acesso ao banco de dados JSON e desempenho de rede do WebSocket.
* **Ações Comuns**: Projetar o consumo de CPU/RAM do FFmpeg (ex: limitar threads e processos simultâneos de transcodificação), estruturar novos schemas no `src/datacache/` e definir o payload de mensagens do WebSocket para o controle remoto em `/remote`.
* **Entrega**: Criação e atualização de especificações técnicas (`SPEC`) e decisões de design.

### 3. Amelia (Senior Developer — `bmad-agent-dev`)
* **Foco**: Escrever código Javascript limpo, gerenciar streams de vídeo assíncronos no Node.js e implementar designs responsivos usando Bootstrap 5.
* **Ações Comuns**: Adicionar novos endpoints em `server.js`, debugar processos filhos do FFmpeg, implementar a lógica do player em `public/js/` ou `views/play.ejs` e manipular chamadas AJAX do gerenciador de arquivos chunked.
* **Entrega**: Pull Requests funcionais, tratamento robusto de erros e testes unitários.

### 4. Sally (UX/UI Designer — `bmad-agent-ux-designer`)
* **Foco**: Usabilidade e responsividade das páginas EJS e navegação do controle remoto no celular.
* **Ações Comuns**: Melhorar a folha de estilos CSS, garantir que o painel de controle remoto seja confortável de usar com o polegar em dispositivos móveis, e organizar o grid Bootstrap das galerias de fotos, vídeos e músicas.
* **Entrega**: Protótipos de tela, estilizações e especificações de interações animadas.

---

## 🔄 Fluxo de Trabalho Integrado

### Fluxo de Transcodificação (Exemplo de Colaboração)
Para adicionar suporte a um novo formato de áudio (ex: Opus) na aplicação:

1. **John** cria uma história de usuário detalhando o comportamento desejado do player quando este formato for carregado.
2. **Sally** valida se o player precisa mostrar algum ícone indicativo do codec de áudio.
3. **Winston** avalia se o navegador suporta Opus nativamente ou se o FFmpeg precisará re-encapsular o stream em tempo real. Ele adiciona a configuração de transcodificação em `server.js`.
4. **Amelia** codifica as rotas em `server.js` e testa a reprodução integrada com o player na view.
5. **Revisores Adversariais** testam arquivos Opus corrompidos ou mal-formados para garantir que o Node.js não sofra um crash silencioso.

---

## 💬 Discussões Multifuncionais (Party Mode)

Ao planejar mudanças estruturais de grande escala (por exemplo, migrar de um banco JSON para um SQLite local), sugere-se acionar o **Party Mode** (`/teamwork-preview` ou `bmad-party-mode`).

Os agentes debaterão os seguintes tópicos críticos do BlackBird Media Center:
* **Winston**: Abordará os benefícios de concorrência e integridade referencial do SQLite.
* **Amelia**: Trará a facilidade de escrita das queries e migrações no Express.
* **John**: Monitorará o risco de retrocompatibilidade do banco JSON legado (`datacache/config.json`, etc.) dos usuários atuais.
* **Usuário (Você)**: Tomará a decisão final com base nos prós e contras gerados.
