# MockDeskAI — Pickup Note (2026-03-15)

## What Is This
AI-powered PSD design proofing desktop app (Electron). Sales reps in the decorated apparel industry upload PSD mockup files, describe edits in natural language, and the AI modifies the design. Target: Derek (ex-SVP Sales at Richardson Sports) and his team. No direct competitor exists.

## Architecture
```
Electron App (~/Desktop/DEV/New/mockdeskai-app/)
├── main.js                 — Electron main process, starts Express, creates window
├── preload.js              — Context bridge (platform info)
├── server/
│   ├── index.js            — Express + WebSocket + all API routes (multer for uploads)
│   ├── claude.js           — Claude CLI spawn + NDJSON stream parser (finds ~/.local/bin/claude)
│   └── workspace.js        — ~/MockDeskAI/ directory management, settings, chat history, file ops
├── src/
│   ├── main.jsx            — React entry, checks Claude CLI → SetupWizard or App
│   ├── App.jsx             — Main editor: multi-tab, toolbar, canvas, chat, layers panel
│   ├── FileTree.jsx        — Left sidebar: EXPLORER, search, upload modal, context menu, drag-drop
│   ├── Settings.jsx        — Settings modal: Profile, Appearance, AI Assistant, Workspace, About
│   ├── SetupWizard.jsx     — First-launch Claude CLI install/auth flow
│   ├── hooks/useWebSocket.js — WebSocket with auto-reconnect
│   ├── workers/psd-worker.js — ag-psd Web Worker (parse, edit, render, rename, delete)
│   ├── lib/psd-client.js   — Promise-based PSD API + ensureLoaded for tab switching
│   └── services/psdJsonContext.js — Builds Claude prompt context, parses JSON command responses
├── dist/                   — Vite production build
└── release/mac-arm64/      — Packaged .app
```

## Workspace (~/MockDeskAI/)
```
~/MockDeskAI/
├── .claude/                — Claude CLI project config (settings.json)
├── .chats/                 — Chat history per PSD (JSON files)
├── .settings.json          — App settings (profile, theme, tone, workspace prefs)
├── CLAUDE.md               — Project context Claude reads when spawned
├── Imports/                — Default upload destination
└── Exports/                — Default export destination
```

## Repos
- **App**: github.com/kevindeanai33/mockdeskai-app (Electron app)
- **Site**: github.com/kevindeanai33/mockdeskai-site (Landing page)
- **GitHub Release**: v0.1.1-beta on mockdeskai-app (Mac ARM64 zip)

## Landing Page (mockdeskai.com)
- AWS Amplify app ID: d2uxyverxfjniq (us-east-1)
- Route 53 hosted zone: Z05699261T5FD4LI90YBX
- Deploy: zip + `aws amplify create-deployment` + upload + `start-deployment`
- Currently NO password protection (disabled for Derek preview)
- GSAP animated, Awwwards-style single-page HTML
- Download button links to GitHub Release

## AWS
- IAM user: vaccelerator-2452 (account 300048424109)
- Policies: AdministratorAccess-Amplify, AmazonRoute53FullAccess, IAMReadOnlyAccess
- AWS CLI configured on this machine (~/.aws/credentials)
- Nameservers: Namecheap → Route 53

## What Works Right Now
- **Multi-tab PSD editor** — open multiple PSDs, independent state per tab
- **File tree** — upload (multi-file modal), rename, delete, drag-drop between folders, right-click context menu, search, create folder, toggle hidden files
- **Canvas viewer** — zoom (scroll), pan (click-drag), reset view
- **Layer panel** — collapsible groups (all collapsed by default), visibility toggle, rename (double-click), delete (trash on hover), right-click context menu
- **AI chat** — Claude CLI streaming via WebSocket, tone settings (Professional/Casual/Concise/Detailed/Pirate), auto-scroll during streaming, chat history persists per PSD
- **Settings panel** — Profile, Appearance, AI Assistant (tone selector), Workspace, About
- **Toolbar** — Claude badge (spins during AI), gear icon, Layers toggle, Export dropdown (PNG/JPG/PSD)
- **Setup wizard** — detects Claude CLI on first launch, guides through install/auth
- **Connection status** — animated pulse in file tree footer

## Available AI Commands (PSD Worker)
| Command | What it does |
|---------|-------------|
| set_text | Change text layer content |
| set_visibility | Show/hide a layer |
| set_opacity | Change layer opacity (0-255) |
| set_text_color | Change text color (hex) |
| set_font_size | Change font size |
| set_font | Change font family |
| move_layer | Change layer x/y position |
| resize_layer | Resize text layer bounds |
| rename (UI only) | Rename a layer |
| delete (UI only) | Delete a layer |

## What Needs Building Next

### Save & Versioning (Priority)
- Auto-save modified PSD after each edit to .versions/ folder
- Version history panel per file
- Cmd+S manual save
- ag-psd writePsd() for PSD export (currently only PNG/JPG export works)

### Medium Priority
- Visual text preview (canvas-first re-rendering — rerenderTextLayer exists but fonts won't match)
- Font picker UI (Google Fonts dropdown)
- Click-to-select layer on canvas (hit detection)
- Direct text editing (click text layer, type inline on canvas)
- PSD export via ag-psd writePsd() wired to Export dropdown

### Lower Priority
- Drag-to-move layers on canvas
- Resize handles on selected layer
- Code signing for macOS distribution (required for Derek)
- Windows build
- Auto-updater (electron-updater)
- Amplify CI/CD (GitHub App not connected yet — manual zip deploy)
- .ai file support (v2 — partial via PDF-compatible parsing)
- Light mode theme

## Key Technical Notes
- **Tab switching**: each tab stores rawBuffer, worker re-parses via ensureLoaded() when switching
- **Claude CLI path**: resolved via findClaudePath() checking ~/.local/bin/claude and common locations
- **Claude CWD**: spawns in ~/MockDeskAI/ so CLAUDE.md is picked up
- **Text re-rendering**: rerenderTextLayer() in worker uses Canvas 2D fillText — approximate, not pixel-perfect
- **Upload**: multer multipart (not base64) to handle large PSDs
- **Spacebar**: captured for pan shortcut but skipped when typing in input/textarea
- **Export dropdown**: relative-positioned menu with click-outside handler
- **Settings**: saved to ~/MockDeskAI/.settings.json, loaded on mount, tone injected into Claude prompts

## Derek Context
- Ex-SVP Sales at Richardson Sports ($400M/yr distributor)
- Saw mockdeskai.com, wants to meet (meeting today 3/15)
- Promise: downloadable app by next weekend
- Key workflow: rep proofs with client → approves → hands PSD to art team for production .ai
- Brand-agnostic messaging (removed Richardson references)
- 2-week proof turnaround is the real pain point being solved

## Build Commands
```bash
cd ~/Desktop/DEV/New/mockdeskai-app
npx vite build                                    # Build frontend
npx electron-builder --mac --dir -c.mac.identity=null  # Package .app
# Then from release/mac-arm64/:
zip -r -y /tmp/MockDeskAI-mac-arm64.zip MockDeskAI.app
# Upload to GitHub Release
gh release upload v0.1.1-beta /tmp/MockDeskAI-mac-arm64.zip --repo kevindeanai33/mockdeskai-app --clobber
```

## Deploy Landing Page
```bash
cd ~/Desktop/DEV/New/mockdeskai-site
zip -r /tmp/site.zip index.html amplify.yml
DEPLOY=$(aws amplify create-deployment --app-id d2uxyverxfjniq --branch-name main)
# Extract URL and jobId, curl upload, start-deployment
```
