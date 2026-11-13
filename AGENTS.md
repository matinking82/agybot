# AGENTS.md — Antigravity Agent Telegram Bot

A Telegram bot that is a remote control for the `agy` (Antigravity) AI agent CLI. Authorized admins can chat with the agent, manage project folders, clone git repos, and run shell commands on the host, all from Telegram.

> **Mandatory rule for all AI agents:** update this `AGENTS.md` whenever you make a significant change (new feature, new state, new callback, schema change, routing change, new env var). This file is the source of truth for future agents.

---

## Stack

- **TypeScript** (CommonJS, compiled with `tsc` to `dist/`, run in dev with `tsx`)
- **grammy** — Telegram bot framework (long polling, `bot.start()`)
- **Prisma 7** with the `@prisma/adapter-mariadb` driver adapter → MariaDB/MySQL. Client is generated to `generated/prisma` (git-ignored).
- **node-pty** — drives the interactive `agy` TUI to scrape `/usage` quota
- **winston** — logging to console and `logs.log`
- **bcrypt** — admin password hashing

## Commands

```bash
npm run dev          # tsx index.ts
npm run build        # tsc -> dist/
npm start            # node dist/index.js
npx prisma generate  # regenerate client into generated/prisma (needed after schema changes)
npx prisma db push   # sync schema to DB (no migrations are committed; Docker entrypoint runs this)
docker compose up -d # MariaDB 11 + app; workspace volume mounted at /tmp/agent-workspace
```

`npm test` runs `tsx --test` (Node's built-in `node:test`) over `**/*.test.ts`. Tests cover pure functions only (`core/*.test.ts`) plus `services/agentService.test.ts` (real processes, no DB). Test files are excluded from `tsc`. Keep functions under test in files that do not import `dbContext` or `bot`.

## Environment variables (`.env`, see `.env.example`)

| Var | Purpose |
|-----|---------|
| `BOT_TOKEN` | Telegram bot token (required; `bot.ts` throws without it) |
| `DATABASE_URL` | `mysql://user:pass@host:port/db`, parsed in `services/dbContext.ts` |
| `INITUSERNAME` / `INITPASSWORD` | Admin account created on startup by `initializeAdmin()` |
| `AGENT_WORKSPACE` | Default cwd for commands / agent when no project is active (default `/tmp/agent-workspace`) |
| `PROXY_TELEGRAM_API` | Optional alternate Telegram API root |
| `JOINCHANNELS` | Optional comma-separated channels users must join (checked in `botAuth.ts`) |
| `ALLOWED_USER_IDS` | Optional comma-separated Telegram ids allowed to `/login`; others get the generic "Invalid credentials" |
| `COMMAND_TIMEOUT_MS` | Optional Execute Command timeout (default 600000 = 10 min) |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` | Used by `docker-compose.yml` |
| `JWT_SECRET` | Present in `.env.example` but unused |

**Important:** every child process (`executeCommand`, `cloneRepository`, `runAgyCli`, `getAgyModels`, `getSystemInfo`, `getAgyUsageQuota`) runs with `getCleanEnv()`, which strips every key defined in `.env` so the bot's secrets never leak to user commands or the agent.

---

## Project layout

```
index.ts                 entry: initializeAdmin() -> bot.init() -> setMyCommands -> bot.start()
bot.ts                   Bot instance, middleware, /start /login /logout /help, message + callback_query listeners
botHandlers/
  generalHandlers.ts     central router: startHandler, messagesHandler (menu text + UserState), callBackHandler (callback data)
  adminHandlers.ts       /login <user> <pass>, /logout  -> toggles User.isAdmin
  agentHandlers.ts       every agent feature (chat, stop, sessions, file upload / /get, projects, git, folder selector, commands, tasks, models, stats)
services/
  dbContext.ts           PrismaClient + MariaDB adapter; patches BigInt.prototype.toJSON
  adminDbServices.ts     registerAdmin, loginAdmin, getAdminById, initializeAdmin
  userDbServices.ts      isExist, createUser, getUserById, get/setUserState, setUserAdmin, get/setUserData
  projectDbServices.ts   createProject, getProjects, getProjectById, deleteProject (DB row only, files untouched)
  taskDbServices.ts      createTask, updateTaskStatus, getTasksByUser, getTaskById (filters on userId), getUsageCounts
  sessionDbServices.ts   upsertSession, getSessions, getSessionById (filters on userId)
  conversationDbServices.ts addMessage, getConversationHistory, clearConversation
  agentService.ts        OS layer: executeCommand, cloneRepository, runAgyCli, stop/isRunning for agent and command, getAgyModels, listDirectory, getDirectories, makeDirectory, getFileStat, saveTelegramFile, getSystemInfo, getAgyUsageQuota, getWorkspace
  telegramServices.ts    getTelegramUserInformation, sendTelegramMessage (via the shared bot instance)
middlewares/
  botAuth.ts             loginUserMiddleware: ignores channel posts, optional channel-join check, auto-creates User row
  adminGuard.ts          adminGuard(userId) boolean check; requireAdmin middleware (currently unused)
core/
  enums.ts               UserState
  keyboards.ts           all reply/inline keyboards + adminMenuOptions labels
  telegramText.ts        pure: tailForTelegram, isValidRepoUrl, safeUploadName, escMd / escCode (MarkdownV2)
  agyOutput.ts           pure: parseAgyModels (`agy models`), parseUsageOutput (`/usage` panel)
  logger.ts              winston logger
  passwordHelper.ts      bcrypt hash/compare
prisma/schema.prisma     data models
Dockerfile, docker-compose.yml, docker-entrypoint.sh   deployment
.agents/rules/           Antigravity rule files (RTK)
```

`error.txt` and `output.txt` in the root are stray scratch files, not part of the app.

---

## Data model (`prisma/schema.prisma`)

- **`admin`** — `username`, bcrypt `password`. Credentials only; being logged in is tracked on `User.isAdmin`.
- **`User`** — `Id` is the Telegram user id (`BigInt`). `state` holds a `UserState`. `isAdmin` is set by `/login`, cleared by `/logout`. `data` is a free-form JSON bag (see below).
- **`Conversation`** — log of chat messages (`role`: `user` | `assistant`). Used for stats/history only; the agent's real context comes from the `agy` conversation id.
- **`Project`** — `name`, absolute `path`, `description`, `createdBy` (Telegram id).
- **`AgentTask`** — one row per shell command run: `command`, `status` (`running` while it runs, then `completed|failed`; a stop is `failed` with error `Stopped by user`), full `output` (last 1 MB), `error`, optional `projectId`.
- **`AgentSession`** — one row per agy conversation: `userId`, `conversationId` (unique per user), `title` (first 40 chars of the first prompt, set on create only), `projectPath`, `updatedAt` (bumped on every turn). Powers "🕘 Sessions".

No foreign keys/relations are declared; ids are linked by convention.

### `User.data` JSON keys

Read with `getUserData(userId)` → `{ data }`, write the whole object back with `setUserData(userId, data)` (always spread/merge the existing object; it's a full replace).

| Key | Set by | Meaning |
|-----|--------|---------|
| `activeProjectPath`, `activeProjectId` | `setActiveProject` (project select / open / cmd / agent / detach, folder select), session open | cwd for commands and agent; cleared by Detach. Changing the path also deletes `conversationId` |
| `conversationId` | `runAgentPrompt`, session open | `agy` conversation id, passed as `--conversation` to resume; removed by New Chat |
| `selectedModel` | `selectModelHandler` | model **id** from `agy models`, passed to `agy --model` |
| `currentBrowsePath`, `currentDirs` | `showFolderSelector` | folder-selector cursor and directory list (buttons reference dirs by index) |
| `pendingOperation` (`new`\|`clone`), `pendingProjectName`, `pendingRepoUrl` | project-name / repo-url handlers | what `dir_select` should do |

---

## Request flow

1. `bot.ts` receives an update; `loginUserMiddleware` makes sure a `User` row exists.
2. Commands (`/start /login /logout /stop /get /help`) go to their handlers. Every listener wraps its handler in `new Promise(async () => { try … catch → logger.error })` so one failing update never blocks or crashes the bot. Keep this pattern for new listeners.
3. Text messages → `messagesHandler`:
   - `"❌ Cancel"` → `cancelHandler` (state → `start`, show menu).
   - Document or photo → `fileUploadHandler` (admin only).
   - If admin and the text matches an `adminMenuOptions` label → that feature's handler.
   - Otherwise route by `UserState` (`chat`, `awaiting_project_name`, `awaiting_repo_url`, `awaiting_new_folder_name`, `awaiting_command`).
4. Callback queries → `callBackHandler`, which rejects non-admins first, then routes by callback data. The listener in `bot.ts` answers every callback afterwards (errors ignored), so handlers that forget to answer don't leave a spinner.
5. Handlers call services and reply. Services return `{ success, message, data? }` (DB) or `{ success, output, error? }` (OS).

### Callback data

| Data | Handler |
|------|---------|
| `project_new`, `project_list`, `project_clone` | new project / list / clone start |
| `project_select_<id>` | `selectProjectHandler` (sets active project, shows listing + actions) |
| `paction_<open\|detach\|cmd\|agent\|git\|delete>_<id>` | `projectActionHandler` |
| `confirm_delproject_<id>` | `confirmDeleteProjectHandler` |
| `dir_nav_<index>`, `dir_up`, `dir_new`, `dir_select`, `cancel_folder` | folder selector |
| `model_select_<index>` | `selectModelHandler` |
| `chat_clear` | `clearChatHandler` ("🆕 New Chat") |
| `agent_stop`, `cmd_stop` | `stopHandler` (Stop button on a running agent / command) |
| `session_list`, `session_open_<id>` | `sessionListHandler`, `sessionOpenHandler` |
| `task_list`, `task_view_<id>`, `task_rerun_<id>` | `taskHistoryHandler`, `taskViewHandler`, `taskRerunHandler` |
| `paction_git_<id>` → `git_<status\|diff\|log\|pull\|push>_<id>` | `gitActionHandler` (fixed command map, nothing interpolated) |
| `start` | channel-join "confirm" button → `startHandler` (handled before the admin check) |
| `back_menu` | show main menu |
| `cancel_*` | generic cancel (must stay after the more specific `cancel_folder`) |

Telegram limits callback data to 64 bytes — that's why dirs and models are referenced by index, not name.

---

## Features

- **Chat with Agent** (`UserState.chat`): `chatMessageHandler` → `runAgentPrompt(ctx, userId, prompt)` → `runAgyCli(userId, prompt, activeProjectPath, selectedModel, conversationId, onProgress)`, which spawns `agy --output-format stream-json --prompt=<text> [--model=…] [--conversation=…]` (agy ≥ 1.5; **do not** use `--prompt -`, agy ignores stdin). It parses the NDJSON events: `init` (conversation id), `step_update` (tool calls → `🔧 tool: cmd` lines, `text_delta` → streamed reply), `result` (`status`, per-turn `response`, `error`). The "🤖 Thinking..." message (with a ⏹ Stop button) is edited at most every 1.5 s; the final reply is that turn's `response`, sent without `parse_mode`; the message shows the tail and replies over 4000 chars are also attached as `agent-output.txt`. Each turn upserts an `AgentSession`.
- **Stop / overlap**: one agent run and one command per user at a time (`runningAgents` / `runningCommands` maps in `agentService.ts`, in memory). Children are spawned `detached`; `stopAgent` / `stopCommand` send SIGTERM to the process group, SIGKILL after 5 s. `/stop` stops both; the buttons stop one.
- **New Chat / Sessions**: "🆕 New Chat" (`chat_clear`) drops `conversationId` and the stored `Conversation` rows; "🕘 Sessions" lists the last 10 `AgentSession`s and resumes one (restores its project path, state `chat`).
- **Files**: a document/photo from an admin is saved (`saveTelegramFile`, ≤ 20 MB, `path.basename` + timestamp prefix instead of overwriting) into the active project or workspace; in chat state the agent is then told `I uploaded the file <path>.` plus the caption. `/get <path>` sends a file (relative to the active project / workspace, ≤ 50 MB); no sandboxing on purpose (admins can already run commands).
- **Projects**: create (name → folder selector), list, clone repo (URL validated by `isValidRepoUrl` → folder selector → `git clone --` via `execFile`, no shell; clones into the selected folder if empty, else `<folder>/<repo>`), open, detach, run command in project, ask agent in project, 🌿 Git buttons (status/diff/log/pull/push), delete (DB row only).
- **Interactive folder selector**: `showFolderSelector` starts at `AGENT_WORKSPACE || os.homedir()` (created if missing), shows at most 40 subdirectories (+ "… N more not shown"), with Up / New Folder / Select / Cancel.
- **Execute Command** (`UserState.awaiting_command`): `runCommandForUser` → `executeCommand(command, cwd, userId, onProgress)`: `spawn` with a shell, stdout+stderr merged in arrival order, last 1 MB kept, `COMMAND_TIMEOUT_MS` (10 min default), stdin closed. Live output in a code block with ⏹ Stop; long output attached as `command-output.txt`. Each run is an `AgentTask`.
- **System Info**: node/npm/git/agy versions + workspace path.
- **Task History**: last 10 tasks with `#id` buttons → view (command, status, project, times, output) → 🔁 Run again (in the **current** active project).
- **Model Selection**: list comes from `agy models` (`getAgyModels`, cached; refreshed when the menu opens), buttons by index, the model id is stored.
- **Usage Quota Stats**: counts (`getUsageCounts`), then `getAgyUsageQuota` opens `agy` in a pty (accepts the folder-trust prompt once), sends `/usage`, waits for the panel footer and parses it with `parseUsageOutput` (group · limit → `% left · Refreshes in …`; 20 s timeout, `[]` on failure).
- **Login hardening**: `/login` deletes its own message, allows 5 failures per 15 min per Telegram id (in memory), honours `ALLOWED_USER_IDS`, and always answers "Invalid credentials" on failure.

---

## Development guidelines

- **Layering:** handlers parse `ctx`, check auth, call services, format replies. DB and OS access belong in `services/`. 
- **Admin checks:** every agent feature requires `adminGuard(userId)`. `callBackHandler` checks once for all callbacks; state handlers in `messagesHandler` check per case.
- **State:** when a flow needs follow-up input, add a `UserState`, set it, handle it in `messagesHandler`, and set it back to `UserState.start` on finish/cancel.
- **Style:** use `let` (the codebase rarely uses `const`), 4-space indent, double quotes.
- **Errors:** wrap async work in `try/catch`, log with `logger.error(error, { section: "functionName" })`, return `{ success: false, ... }` instead of throwing.
- **MarkdownV2:** escape dynamic text with `escMd` (plain text) and `escCode` (inside backticks / code blocks) from `core/telegramText.ts`.
  - Command output is sent in a MarkdownV2 code block using the backtick escape; agent chat output is sent **without** `parse_mode`.
- **Telegram limits:** messages ≤ 4096 chars (show `tailForTelegram(text)` and attach the full text as a file), callback data ≤ 64 bytes, bot downloads ≤ 20 MB, uploads ≤ 50 MB.
- **Security:** this bot runs arbitrary shell commands and an autonomous agent on the host. Never loosen the admin guard, never pass `.env` secrets to child processes, and never interpolate user text into a shell command (use `execFile`/`spawn` with an args array, as `cloneRepository` and `runAgyCli` do).
- **Schema changes:** edit `prisma/schema.prisma`, run `npx prisma generate` and `npx prisma db push`, then update the data model section above.

---

## RTK — Rust Token Killer (Antigravity rule)

Also defined in `.agents/rules/antigravity-rtk-rules.md`. When `rtk` is installed, prefix shell commands with it to compress output and save tokens:

```bash
rtk git status
rtk ls src/
rtk grep "pattern" src/
rtk gain              # show token savings
rtk proxy <cmd>       # run raw, unfiltered
```
