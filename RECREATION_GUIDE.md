# Technical Specifications & Architecture Guide: `shbd | bioinfo.guru`

This document provides a comprehensive technical overview and step-by-step implementation architecture for building and reproducing the **shbd / bioinfo.guru Markdown & Typst Editor**.

---

## 1. System Overview

**shbd** is a hybrid Markdown & Typst web editor with live preview, syntax highlighting, diagram rendering, versioning (checkpoints), and PDF export capabilities.

### Key Capabilities
- **Rich Markdown Editing**: WYSIWYG editing backed by TipTap with seamless raw Markdown conversion.
- **Custom Extensions**: Custom nodes for HTML blocks (`{=html}`), Mermaid diagrams, SVG blocks, code blocks (via Shiki), and Markdown tables.
- **Typst Support**: Multi-format document creation with optional Typst code support and Typst compilation service integration.
- **Data Persistence**:
  - **Authenticated Users**: Remote persistence using Turso (LibSQL SQLite) via Drizzle ORM.
  - **Guest/Public Mode**: Local draft management in browser memory.
- **Authentication**: BetterAuth integration for OAuth (GitHub, Google) with session cookie security.
- **PDF Export**:
  - **Client-side PDF**: `html2pdf.js` for Markdown documents.
  - **Server-side Typst PDF**: Web service endpoint converting `.typ` source files into PDFs.
- **Deployment**: Edge-compatible deployment via Cloudflare Pages / Cloudflare Workers (`wrangler.toml`).

---

## 2. Technology Stack & Architecture

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | [Nuxt 3 / Vue 3](https://nuxt.com/) | App structure, SSR/SSG capability, API routes, layout management |
| **Editor Core** | [TipTap 3](https://tiptap.dev/) | Headless rich-text editor engine & ProseMirror extensions |
| **Styling** | [Tailwind CSS v3](https://tailwindcss.com/) | UI styling & typography layout |
| **Markdown Parsing** | `marked`, `dompurify` | Client/server HTML rendering & sanitization |
| **Code & Diagrams** | `shiki`, `mermaid` | Syntax highlighting & live diagram rendering |
| **Database** | [Turso (LibSQL)](https://turso.tech/) + [Drizzle ORM](https://orm.drizzle.team/) | Distributed SQLite database & schema management |
| **Authentication** | [BetterAuth](https://www.better-auth.com/) | Social logins (Google, GitHub) + Session management |
| **PDF Generation** | `html2pdf.js` / Typst REST API | Converting rendered content to PDF documents |
| **Target Runtime** | Cloudflare Pages (`cloudflare_pages` Nitro preset) | Serverless edge execution |

---

## 3. Core Architecture & Component Breakdowns

```
Editor Workspace Structure
├── app/
│   ├── assets/css/tailwind.css         # Global styles & typography overrides
│   ├── components/
│   │   ├── admin/                      # Admin control panels & user management
│   │   ├── auth/                       # Sign-in & social auth UI components
│   │   └── editor/
│   │       ├── EditorWorkspace.client.vue # Primary workspace orchestrator
│   │       ├── CodeBlockNodeView.vue    # Shiki syntax block component
│   │       ├── HtmlBlockView.vue        # HTML raw block component with live preview
│   │       ├── MermaidNodeView.vue     # Mermaid diagram render node view
│   │       └── SvgNodeView.vue         # SVG render node view
│   ├── extensions/                     # Custom TipTap nodes
│   │   ├── aiGhostText.ts              # Inline AI completion extension
│   │   ├── codeBlockShiki.ts           # Code highlighting extension
│   │   ├── htmlBlock.ts                # Pandoc-style raw HTML block (`{=html}`)
│   │   ├── markdownTableBlock.ts       # Table extension wrapper
│   │   ├── mermaidBlock.ts             # Mermaid syntax extension (`mermaid`)
│   │   └── svgBlock.ts                 # SVG node extension (`svg`)
│   ├── layouts/
│   │   └── default.vue                 # Primary app container (Header, Nav, Footer)
│   ├── pages/
│   │   ├── index.vue                   # Main editor root page
│   │   ├── guide.vue                   # Usage & syntax documentation
│   │   ├── pricing.vue                 # Subscription / tier pricing breakdown
│   │   └── p/[token].vue               # Public document viewer endpoint
└── server/
    ├── api/
    │   ├── auth/[...].ts               # BetterAuth route handler
    │   ├── documents/                  # CRUD operations & checkpoint endpoints
    │   └── export/pdf.ts               # Typst backend proxy compiler
    └── db/                             # Drizzle schema definitions & Turso connection
```

---

## 4. Key Implementation Details & Workflows

### 4.1 Markdown Synchronization & Alignment Engine

To prevent lost content or layout mutations between TipTap's ProseMirror AST and raw Markdown strings:
1. **Lossless Blank Run Normalization**: Canonical newline spacing is explicitly extracted and expanded via custom regex matchers before the TipTap parser ingests the content.
2. **Text Alignment Directives**: Custom parsing rules track text alignments (`left`, `center`, `right`) on block elements during export and re-apply them when loaded into TipTap.

### 4.2 Raw HTML & SVG Blocks

- **Custom TipTap Node**: `htmlBlock.ts` captures block fences styled as ```{=html} ... ```.
- **Sanitizer Pipeline**: Input inside raw blocks is passed through DOMPurify prior to rendering in both the live preview pane and export engines to protect against XSS vectors while permitting full CSS inline/utility styling.
- **Tailwind Play CDN Integration**: Loaded dynamically in `nuxt.config.ts` (`script` head section) so custom HTML utility classes render dynamically inside user-authored HTML blocks.

### 4.3 Database Schema (Drizzle + Turso)

The database schema (`server/db/schema.ts`) relies on:
- **`user`**, **`session`**, **`account`**, **`verification`**: BetterAuth managed tables.
- **`documents`**: Document metadata (`id`, `user_id`, `title`, `content`, `format`, `updated_at`, `created_at`).
- **`checkpoints`**: Document snapshots for version history (`id`, `document_id`, `label`, `content`, `created_at`).

### 4.4 Authentication Flow

- **Backend Handler**: `server/api/auth/[...].ts` wraps `betterAuth({ adapter: drizzleAdapter(db, { provider: 'sqlite' }) })`.
- **Client Client**: `app/lib/auth-client.ts` exports `createAuthClient()` for social auth triggers (`signIn.social({ provider: 'google' | 'github' })`).

---

## 5. Step-by-Step Instructions to Recreate the Project

### Prerequisites
- **Node.js**: v18.x or higher
- **Package Manager**: `npm`
- **Turso Account & Database**: Required for server database persistence.

### Step 1: Clone & Install Dependencies

```bash
# Initialize Nuxt 3 project
npx -y create-nuxt-app editor

# Install required dependencies
npm install @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-table @tiptap/extension-text-align @tiptap/markdown @tiptap/pm @nuxtjs/tailwindcss @tailwindcss/typography better-auth @better-auth/drizzle-adapter drizzle-orm @libsql/client marked dompurify mermaid shiki html2pdf.js gemoji

# Install development dependencies
npm install -D drizzle-kit typescript vitest vue-tsc
```

### Step 2: Configure Environment Variables

Create a `.env` file in the root folder based on the following template:

```env
# Nuxt & Base URLs
NUXT_PUBLIC_SITE_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=your_random_secret_string

# Database (Turso)
TURSO_URL=libsql://your-database-name.turso.io
TURSO_AUTH_TOKEN=your_turso_token

# Social OAuth (Optional for local dev)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# AI Completion (Optional)
NUXT_AI_PROVIDER=nvidia
NUXT_NVIDIA_API_KEY=your_nvidia_key
NUXT_NVIDIA_MODEL=openai/gpt-oss-20b
```

### Step 3: Run Database Migrations

```bash
# Generate Drizzle migrations
npx drizzle-kit generate

# Push migrations to Turso
npx drizzle-kit push
```

### Step 4: Development & Build Execution

```bash
# Run local development server
npm run dev

# Run Vitest test suite
npm run test

# Build for Cloudflare Pages production deployment
npm run build
```

---

## 6. Verification & Validation Checklist

When reproducing or deploying this repository, verify the following core features:

1. **Local & Auth Persistence**: Confirm that anonymous users can edit local drafts, and logging in via OAuth loads remote documents from Turso.
2. **Raw HTML Blocks**: Verify that adding `{=html}` blocks allows custom HTML/SVG elements to render in both the editor pane and preview.
3. **Diagrams**: Confirm that `` `mermaid `` code blocks parse into SVG diagrams without throwing rendering exceptions.
4. **PDF Export**: Test client PDF generation (`html2pdf.js`) to verify layout, table, and block consistency.
