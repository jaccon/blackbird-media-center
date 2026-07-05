# Skills para Desenvolvimento no BlackBird Media Center

As **Skills** do BMAD Method são atalhos cognitivos e de engenharia que automatizam partes do ciclo de desenvolvimento do **BlackBird Media Center**. Este guia explica como utilizar essas ferramentas de forma prática ao lidar com o código de `src/`.

---

## 🛠️ Guia de Aplicação de Skills para Tarefas Comuns

Abaixo estão listados cenários reais de manutenção do Media Center e quais skills devem ser invocadas:

### 1. Adicionar ou Modificar Endpoints em `server.js`
* **O Problema**: Modificações manuais no servidor podem quebrar transcodificações em andamento ou corromper arquivos JSON no `datacache/`.
* **Como Agir**:
  1. Use `bmad-spec` para mapear a mudança no contrato de API ou rota (ex: criar rota para download direto do arquivo de mídia original).
  2. Implemente a funcionalidade com `bmad-dev-story` (se criada uma história) ou `bmad-quick-dev` (para melhorias rápidas).
  3. Execute `bmad-code-review` para validar se o tratamento de erros foi adicionado corretamente (ex: evitar travamentos em caso de arquivo ausente).

### 2. Alterar o Layout ou Estilos do Frontend
* **O Problema**: A interface web (`views/`) usa EJS, CSS sob `public/css/` e componentes Bootstrap 5. Alterações desordenadas podem quebrar a responsividade em smartphones ou Smart TVs.
* **Como Agir**:
  1. Invoque `bmad-ux` para planejar o comportamento do layout de grid ou navegação por controle remoto.
  2. Use `bmad-quick-dev` passando as orientações de estilo.
  3. Valide o layout visual rodando localmente.

### 3. Melhorar Processos do FFmpeg e Streaming de Vídeo
* **O Problema**: Lidar com FFmpeg assíncrono, escrita de arquivos HLS e manipulação de fluxos exige precisão cirúrgica no código Node.js.
* **Como Agir**:
  1. Inicie realizando uma investigação detalhada no código atual de streaming usando a skill `bmad-investigate` (ela fará um mapeamento forense dos caminhos de execução do FFmpeg e WebSocket).
  2. Com as descobertas da investigação, use `bmad-create-architecture` para formalizar a nova estratégia de buffer ou formato.
  3. Implemente a mudança usando `bmad-dev-story`.

### 4. Automatizar Testes no Upload ou Reprodução
* **O Problema**: Modificações no upload em chunks (`/upload-chunk`) ou player (`/play`) precisam ser testadas exaustivamente para evitar regressões.
* **Como Agir**:
  1. Invoque `bmad-qa-generate-e2e-tests` solicitando a criação de casos de teste para o fluxo de uploads chunked com falhas parciais de rede.
  2. O sistema gerará roteiros e automações de testes integrados.

---

## ⚙️ Customizando a IA com Regras de Contexto de Projeto

Ao usar as skills no projeto BlackBird Media Center, o sistema de IA carrega automaticamente as regras adicionais definidas em `{project-root}/_bmad/custom/` ou geradas pelo `bmad-generate-project-context`. 

Para garantir a qualidade, as IAs devem seguir estas **Diretrizes Estritas de Desenvolvimento do BlackBird Media Center**:
* **Banco de dados**: Nunca gravar informações de estado fora da pasta `datacache/`.
* **Tratamento do FFmpeg**: Todo processo do FFmpeg instanciado deve registrar listeners para eventos `error` e `end`, garantindo que os processos filhos sejam terminados adequadamente (`.kill()`) em caso de desconexão do cliente.
* **WebSockets**: Sempre tratar desconexões do cliente no WebSocket para limpar buffers e fechar leituras de arquivos abertos.
* **Internacionalização**: Todas as novas mensagens exibidas no EJS devem buscar sua correspondente no dicionário de traduções (`translations.en`, `translations.pt`, `translations.es`) em `server.js`.
