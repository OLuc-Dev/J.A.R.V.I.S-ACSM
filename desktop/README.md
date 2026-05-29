# JARVIS Desktop

Assistente pessoal com IA para Windows — roda na bandeja do sistema, aprende com seu Obsidian vault e usa Claude API para inteligência real.

## Pré-requisitos

- [Node.js 18+](https://nodejs.org)
- Chave da API [OpenRouter](https://openrouter.ai/keys) — acesso a dezenas de modelos, incluindo vários **gratuitos**
- (Opcional, para voz) Chave [Groq](https://console.groq.com/keys) — transcrição de fala grátis

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
2. Cole sua **OpenRouter API Key** (`sk-or-…`)
3. (Opcional) Cole sua **Groq API Key** (`gsk_…`) para falar por voz
4. Escolha um modelo na lista (atualizada ao vivo do OpenRouter — os **gratuitos** vêm primeiro)
5. Defina seu nome, caminho do vault Obsidian e preferências de voz
6. Clique em **Salvar configurações**

> O JARVIS busca a lista de modelos disponíveis em tempo real. Se o modelo
> escolhido ficar indisponível, ele troca automaticamente por um gratuito que
> esteja funcionando.

## Voz

- **JARVIS fala** (text-to-speech): ligue o toggle de voz nas Configurações. Usa as vozes do Windows — instale uma voz `pt-BR` em *Configurações do Windows → Hora e idioma → Fala*.
- **JARVIS ouve** (speech-to-text): clique no microfone, fale, clique de novo. Usa Groq Whisper (grátis).
- **Modo voz**: botão ◎ na barra de título abre o núcleo holográfico em tela cheia para conversa por voz.

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
