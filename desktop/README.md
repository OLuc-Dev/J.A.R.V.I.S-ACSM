# JARVIS Desktop

Assistente pessoal com IA para Windows — roda na bandeja do sistema, aprende com seu Obsidian vault e usa Claude API para inteligência real.

## Pré-requisitos

- [Node.js 18+](https://nodejs.org)
- Chave da API Anthropic (obtenha em [console.anthropic.com](https://console.anthropic.com))

## Instalação (desenvolvimento)

```bash
cd desktop
npm install
npm start
```

## Build (instalador Windows)

```bash
npm run build
# gera dist/JARVIS Setup x.x.x.exe
```

## Configuração

1. Abra JARVIS → aba **Configurações**
2. Cole sua **Anthropic API Key** (`sk-ant-api03-…`)
3. Defina seu nome, modelo preferido, e caminho do vault Obsidian
4. Clique em **Salvar configurações**

## Funcionalidades

| Recurso | Descrição |
|---|---|
| Chat com IA | Streaming em tempo real via Claude API |
| Memória persistente | Fatos extraídos automaticamente das conversas |
| Obsidian Vault | Contexto dos seus `.md` inserido em cada conversa |
| Tarefas & Lembretes | Notificações nativas do Windows |
| Diário diário | Prompt automático no horário configurado |
| Bandeja do sistema | Sempre rodando em segundo plano |

## Estrutura

```
desktop/
  main.js          Processo principal Electron
  preload.js       Bridge segura IPC → renderer
  backend/
    claude.js      Claude API + memória
    vault.js       Leitura/escrita Obsidian
    tasks.js       CRUD de tarefas
    scheduler.js   Agendamentos com node-cron
  src/
    index.html     Interface do app
    style.css      Estilo dark JARVIS
    renderer.js    Lógica da interface
  assets/
    icon.png       Ícone do app e bandeja
```
