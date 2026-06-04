# Antigravity AI Agent Telegram Bot

This project is a powerful Telegram Bot that acts as an interface for the `agy` (Antigravity) AI Agent CLI. It allows authorized administrators to manage coding projects, execute terminal commands, clone repositories, and chat directly with an AI assistant from within Telegram.

## 🚨 MANDATORY RULE FOR ALL AI AGENTS 🚨

**YOU MUST UPDATE THIS `CLAUDE.md` FILE WHENEVER YOU MAKE SIGNIFICANT CHANGES.**
If you add a new feature, change the architecture, modify the database schema, or alter the core routing flow, you are strictly required to update this document to reflect those changes. This ensures the documentation remains the single source of truth for future agents.

---

## 🏗️ Architecture & Project Structure

The project is built with **TypeScript**, **grammy** (for the Telegram bot), and **Prisma** (for database ORM connecting to MariaDB/MySQL).

### 1. Root Level
- `index.ts`: The main entry point. It initializes the admin account and starts the bot.
- `bot.ts`: Initializes the `grammy` bot instance, registers root commands (`/start`, `/login`, `/logout`, `/help`), and sets up root event listeners (`message`, `callback_query`).

### 2. Database (`/prisma`)
- Uses Prisma ORM.
- `schema.prisma`: Contains the data models (`admin`, `User`, `Conversation`, `Project`, `AgentTask`).
- The database is the source of truth for user states, project paths, and task histories.

### 3. Services (`/services`)
**This is where all business logic and external interactions happen.**
- **Rule:** Handlers should NEVER interact directly with Prisma or the OS. They must call functions in the `services/` directory.
- **Return Pattern:** Most service functions return a standardized response object: `{ success: boolean, message: string, data?: any, error?: string }`.
- `dbContext.ts`: Initializes and exports the Prisma client.
- `*DbServices.ts` (e.g., `userDbServices.ts`, `projectDbServices.ts`): Handles all CRUD operations for their respective models.
- `agentService.ts`: Handles all OS-level operations (spawning `agy` CLI, executing terminal commands, cloning git repos, listing directories).

### 4. Bot Handlers (`/botHandlers`)
**This is where Telegram updates are processed and responses are sent.**
- `generalHandlers.ts`: The central router for all incoming text messages and callback queries. It routes requests based on the user's `UserState` or the specific callback data.
- `adminHandlers.ts`: Handles the `/login` and `/logout` flows.
- `agentHandlers.ts`: Contains the logic for all agent features (chatting, project creation, command execution).
- **Rule:** Handlers should focus on parsing the Telegram context (`ctx`), checking authorization, calling the appropriate service, and formatting the response back to the user.

### 5. Middlewares (`/middlewares`)
- `botAuth.ts`: Middleware to ensure users are registered in the database (and optionally checks if they joined required channels).
- `adminGuard.ts`: Contains `adminGuard` (a boolean check function) and `requireAdmin` (a middleware) to protect sensitive routes. All agent features require admin privileges.

### 6. Core (`/core`)
- Contains shared utilities and constants.
- `enums.ts`: Defines `UserState` which is critical for step-by-step conversations (e.g., waiting for a project name vs. waiting for a command). Added state for new folder creation.
- `keyboards.ts`: Centralizes all Telegram inline and custom keyboards (`ReplyKeyboardMarkup`). Updated with model selection, usage stats, and project detach options.
- `logger.ts`: Configures `winston` for application-wide logging.
- `passwordHelper.ts`: Utility for bcrypt hashing.

### 7. New Features (June 2026)
- **Model Selection:** Users can choose from a list of models to use for the AI agent via the admin menu. The selected model is saved in `User.data.selectedModel` and passed to the `agy` CLI via the `--model` flag.
- **Usage Quota Stats:** A new admin menu option that shows the number of projects created, tasks executed, and chat messages sent by the user.
- **Project Detach:** Users can detach from an active project without deleting it, restoring the workspace context to default.
- **Interactive Folder Selector:** When creating a new project or cloning a repo, instead of typing paths, users navigate folders interactively using Telegram inline keyboards. This UI allows browsing, creating new folders, and selecting a destination path starting from `/root`.

---

## 🔄 General Application Flow

1. **User sends a message or clicks an inline button.**
2. **`bot.ts`** intercepts the update.
3. If it's a command (like `/login`), it goes to the specific command handler.
4. If it's a standard message or callback, it goes to **`generalHandlers.ts`**.
5. **`generalHandlers.ts`** checks the `adminGuard`. If authorized, it checks the database for the user's current `UserState`.
6. Based on the state or button clicked, the request is routed to a specific handler in **`agentHandlers.ts`**.
7. The handler parses the input and calls a function in **`services/`** (e.g., `executeCommand` in `agentService.ts` or `createProject` in `projectDbServices.ts`).
8. The service executes the logic (DB query or OS command) and returns a `{ success, ... }` object.
9. The handler evaluates the result and sends a formatted response (MarkdownV2) back to the user via the `ctx` object.

---

## 🛠️ Development Guidelines

- **Variables:** The project predominantly uses `let` for variable declarations instead of `const`. Maintain this style for consistency.
- **Error Handling:** Wrap all async operations in `try/catch` blocks. Log errors using `logger.error(error, { section: "functionName" })`. Never crash the bot on a handled error.
- **Markdown:** Telegram requires strict escaping for `MarkdownV2`. Be very careful when sending dynamic content (like file paths or command outputs) inside Markdown blocks.
- **State Management:** When expecting follow-up input from a user, update their `UserState` in the database, and handle that state in `generalHandlers.ts`. Revert to `UserState.start` when the flow completes or cancels.
- **CLI Execution:** When running shell commands on behalf of the user, respect the `AGENT_WORKSPACE` environment variable as the root boundary.
