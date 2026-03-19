# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
pnpm compile      # One-time dev build → dist/main.js (inline sourcemap, no minification)
pnpm test         # Deploy dist/* to Obsidian plugin dir and reload
pnpm dev          # Watch mode — compiles src/main.ts → main.js (~2s per rebuild)
pnpm build        # Production build with tsc type-check then esbuild
```

**Typical workflow after code changes:**
```bash
pnpm compile && pnpm test
```

Use DevTools console (`Ctrl+Shift+I`) to inspect logs during testing. **Do not run or test the plugin yourself** — the user tests in Obsidian.

Never run `pnpm exec tsc` directly — it generates stray `.js` files across `src/`. Use `pnpm build` for type-checking.

## Architecture Overview

Coderidian is an Obsidian plugin (`Plugin` subclass in `src/main.ts`) with the following major subsystems:

### Entry Points
- `src/main.ts` — Plugin lifecycle (`onload`/`onunload`), service wiring, public API (`findSimilarNotes`)
- `src/commands.ts` — All 16+ command registrations
- `src/settings.ts` — Settings panel and dynamic reinitialization

### AI Image Analysis (`src/ai-image-analysis/`)
Multi-provider image analysis pipeline:
- **`processor.ts`** — Orchestrates full batch analysis workflow
- **`provider/note-parser.ts`** — Parses note markdown, extracts text/image blocks in document order
- **`provider/llm-request/`** — Provider adapters: OpenAI SDK, Obsidian `requestUrl`, MiniMax
- **`provider/upload/`** — Image upload adapters: OpenAI files API, ttl.sh temp hosting, MiniMax, `requestUrl`; `cached.ts` wraps any provider with caching
- **`editor-widget/image-toolbar-manager.ts`** — Floating toolbar using CSS Anchor Positioning (toolbar lives in `document.body` to avoid `overflow:hidden` clipping; `anchor-name` set on hovered image container)
- **`editor-widget/callout-manager.ts`** — Writes AI analysis as Obsidian callout blocks into the note

### Note Similarity (`src/services/note-similarity/`)
Local semantic search using Transformers.js:
- Embeds notes with one of four bundled models (bge-micro-v2, bge-small-en, jina-zh, nomic-v1.5)
- Chunks notes by headings → paragraphs → characters (500 char max, 50 char overlap)
- Stores embeddings in IndexedDB (`storage.ts`)
- Results shown in a sidebar leaf view (`src/views/similar-notes-view.ts`)

### Configuration (`src/config/`)
- **`api-config-manager.ts`** — Multi-config LLM API manager; `getActiveApiConfig()` on the plugin instance returns the active config
- Supports: OpenAI, MiniMax, Doubao/ByteDance (OpenAI-compatible), custom endpoints

### HTTP Interceptor (`src/interceptors/`)
Wraps Obsidian's `requestUrl` with middleware chains: logging, retry (3 attempts), GET caching (5 min TTL).

## Key Conventions

- **HTTP requests**: Use Obsidian's `requestUrl` (not `fetch`) — it bypasses CORS. The interceptor wraps it transparently.
- **Image upload flow**: Download image → upload to temp host (ttl.sh preferred: `PUT https://ttl.sh/<uuid>?ttl=1h`) → pass public URL to LLM. Filter images smaller than 100×100px.
- **Multimodal prompts**: Build content array with strictly alternating `input_text` / `input_image_url` blocks matching document order.
- **Obsidian note output**: Frontmatter with `title`, `date`, `source_url`, `tags`; AI analysis as `> 🤖 ...` blockquote immediately after each image; `[[WikiLinks]]` for key concepts; "关联概念" section at end.
- **plan.md**: Keep updated after each significant change — it tracks cross-session development state.

## Supported LLM Providers

| Provider | SDK/Method | Notes |
|---|---|---|
| OpenAI | `openai` npm package | Vision via `gpt-4o` |
| Doubao | OpenAI-compatible HTTP | `doubao-vision-pro-32k` |
| MiniMax | Custom `requestUrl` | Chinese-optimized |
| Custom | OpenAI-compatible | Any base URL |
