# plans.md — features to build next

Build plan for the Antigravity Agent Telegram Bot. Read `AGENTS.md` first: it describes the stack, layout, routing and code style, and every plan below assumes it.

## How to work through this file

- Build the plans **in order**. Plans 1–4 fix things that are broken or unsafe today; 5–10 are new features. Each plan is independent unless it says "needs plan N".
- One plan = one commit. After each plan run `npm run build` (must pass with no errors) and `npm test`.
- Follow the house rules from `AGENTS.md`: handlers in `botHandlers/`, DB and OS access in `services/`, `let` over `const`, 4-space indent, double quotes, `try/catch` + `logger.error(error, { section })`, services return `{ success, ... }` and never throw.
- Every new feature is admin-only. New callbacks are covered by the single check at the top of `callBackHandler`; new `messagesHandler` cases and new commands need their own `adminGuard(userId)` check.
- Every new listener in `bot.ts` uses the existing `new Promise(async () => { try … catch → logger.error })` wrapper.
- Callback data must stay ≤ 64 bytes: reference things by numeric id or index, never by name or path.
- `setUserData` is a full replace: always re-read with `getUserData` and spread the existing object.
- No new npm dependencies. Everything below is doable with grammy, Node built-ins and what is installed.
- After each plan, update `AGENTS.md` (new state, callback, env var, `User.data` key, feature) and the `/help` text in `bot.ts`. That is a mandatory rule of this repo.
- Do not build anything listed under "Not planned".

## Plan 0 — test runner (do this first)

There are no tests. Later plans each ask for one small test, so wire the runner once.

1. In `package.json` set `"test": "tsx --test"` (Node's built-in `node:test`, run through the already-installed `tsx`; it picks up `**/*.test.ts`).
2. In `tsconfig.json`, add `"**/*.test.ts"` to the existing `exclude` array (currently `node_modules`, `dist`, `generated`) so tests are not compiled into `dist/`.
3. Tests must only cover pure functions. Importing `services/dbContext.ts` or `bot.ts` needs a database and a bot token, so keep the functions under test in files that do not import those.

Done when: `npm test` exits 0 with zero tests.

---

## Plan 1 — stop a running agent, and block overlapping runs

**Problem.** `runAgyCli` has no timeout and no way to cancel. If `agy` hangs, the user can do nothing. If the user sends a second message while the first is running, a second `agy` process starts on the same conversation id, and the two runs overwrite each other's `conversationId` / `lastOutputLength`.

**Build.**

1. `services/agentService.ts`: add a module-level `let runningAgents = new Map<number, ChildProcess>()`.
   - Give `runAgyCli` a new first-class parameter `userId: number`. After `spawn`, `runningAgents.set(userId, child)`. In both the `close` and `error` handlers, `runningAgents.delete(userId)`.
   - Export `isAgentRunning(userId)` and `stopAgent(userId)`. `stopAgent` sends `SIGTERM`, then `SIGKILL` after 5 s if the child is still alive, and returns `true` if there was something to stop.
   - In the `close` handler, pass through whether the process was killed by a signal (`child.on("close", (code, signal) => …)`) as `stopped: true` on the result.
2. `botHandlers/agentHandlers.ts`, `chatMessageHandler`:
   - At the top (after the admin check): if `isAgentRunning(userId)`, reply "⏳ The agent is still working. Press Stop or wait." and return. Do not call `addMessage`.
   - Send the "🤖 Thinking..." message with an inline keyboard holding one button: `⏹ Stop` → callback `agent_stop`. Pass the same `reply_markup` on every progress `editMessageText`, otherwise Telegram removes the button on the first edit. The final edit omits it.
   - If `result.stopped`, edit the message to "⏹ Stopped." plus whatever output arrived, still save `conversationId` if one was discovered, and skip the "couldn't process the request" fallback text.
3. `core/keyboards.ts`: add `agentRunningKeyboard()`.
4. `botHandlers/generalHandlers.ts`, `callBackHandler`: route `agent_stop` → new `stopAgentHandler` (answers the callback query with "Stopping…" or "Nothing is running").
5. `bot.ts` + `index.ts`: add a `/stop` command (admin-checked) calling the same handler, and add it to `setMyCommands`.
6. Update the one other caller: grep for `runAgyCli(` and pass `userId`.

**Limit to note in a code comment:** the map is in memory, so a bot restart forgets running agents (the child processes die with the bot anyway under Docker).

**Test.** None needed for the process plumbing. Verify by hand: start a long prompt, press Stop, confirm the `agy` process is gone (`pgrep agy`) and the next message works.

---

## Plan 2 — fix long output (truncation bug + send as file)

**Problem.** Two things, same root cause.

- `runAgyCli` returns `truncateOutput(stdout)`, capped at 4000 chars. `chatMessageHandler` then stores `lastOutputLength: result.output.length` and, on the next message, does `output.substring(lastOutputLength)` to strip what was already shown. Once a conversation's total stdout passes 4000 chars, both numbers sit near 4000 forever, so the stripping cuts the wrong text (found by reading the code, not reproduced).
- Any agent reply or command output over 4000 chars loses its beginning. The user only ever sees the tail.

**Build.**

1. `services/agentService.ts`: `runAgyCli` returns the **raw, untruncated** stdout as `output`. `executeCommand` also returns its full `output`. Keep `truncateOutput` only for the `error` strings in both; the handlers now decide how much to show.
2. Add a pure helper in a new file `core/telegramText.ts` (no DB or bot imports, so it is testable):
   - `tailForTelegram(text, max = 4000)`: returns the text unchanged if it fits, else the last `max` chars with a `… (truncated, full output attached)` prefix that keeps the total ≤ 4096.
3. `botHandlers/agentHandlers.ts`: add one local helper `replyLongText(ctx, text, filename)` and use it in `chatMessageHandler` (final output) and `handleCommandExecution` (success and failure):
   - if `text.length <= 4000`: behave exactly as today;
   - else: show `tailForTelegram(text)` as today, then also send the full text with `ctx.replyWithDocument(new InputFile(Buffer.from(text), filename))` (`InputFile` is exported by grammy). Filenames: `agent-output.txt`, `command-output.txt`.
4. `chatMessageHandler` keeps computing `lastOutputLength` from the raw length, which is now correct.
5. `AgentTask.output` is `LongText`, so storing the full command output is fine. `Conversation.content` is `Text` (65 KB): slice to 60000 chars before `addMessage`.

**Test.** `core/telegramText.test.ts`: short text is returned unchanged; a 10000-char text comes back ≤ 4096 chars and ends with the original's last characters.

---

## Plan 3 — security hardening

**Problems.**

- `cloneRepository` runs `` `git clone ${repoUrl} ${targetPath}` `` through a shell. A URL such as `x; rm -rf ~` is executed. Admins can already run commands, but a repo URL is exactly the kind of text people paste without reading.
- The `/login <user> <pass>` message stays in the chat history with the password in plain text.
- `/login` can be tried without limit by anyone who finds the bot.
- Anyone on Telegram can attempt a login; there is no allow-list.

**Build.**

1. `services/agentService.ts`, `cloneRepository`: replace `execAsync` with `promisify(execFile)("git", ["clone", "--", repoUrl, targetPath], { timeout, maxBuffer, env: getCleanEnv() })`. No shell, and `--` stops a URL starting with `-` being read as an option.
2. `botHandlers/agentHandlers.ts`, `handleRepoUrl`: reject input that does not match `^(https?:\/\/|git@|ssh:\/\/)\S+$` with a clear message, and stay in `awaiting_repo_url`. Put the regex check in `core/telegramText.ts` as `isValidRepoUrl` so it can be tested.
3. `botHandlers/adminHandlers.ts`, `adminLoginHandler`: call `ctx.deleteMessage()` in a `try/catch` as the first step (it fails harmlessly in chats where the bot cannot delete), for every outcome including wrong usage.
4. Login rate limit, in `adminHandlers.ts`: module-level `Map<number, { count, firstAt }>`. After 5 failed attempts within 15 minutes, refuse further `/login` from that Telegram id until the window passes, and `logger.warn` it. Reset on success.
5. New optional env var `ALLOWED_USER_IDS` (comma-separated Telegram ids). When set, `adminLoginHandler` refuses ids not in the list before checking the password, with the same generic "Invalid credentials" message. Add it to `.env.example` and to the env table in `AGENTS.md`. `getCleanEnv` strips it automatically because it is in `.env`.

**Test.** `isValidRepoUrl`: accepts `https://github.com/a/b.git` and `git@github.com:a/b.git`; rejects `x; rm -rf ~`, `--upload-pack=x`, and a URL containing a space.

---

## Plan 4 — small correctness fixes

1. **Conversation follows the project.** `conversationId` is per user, not per project. Switching the active project keeps resuming the old `agy` conversation in a new working directory. In every place that changes `activeProjectPath` (project select, `paction_open`, `paction_cmd`, `paction_agent`, `paction_detach`, `folderSelectHandler`), when the path actually changes, also delete `conversationId` and `lastOutputLength`. Write one helper `setActiveProject(userId, project | null)` in `agentHandlers.ts` and call it from all of them instead of repeating the `setUserData` blocks.
2. **Folder selector start path.** `"/root"` is hard-coded in six places (`agentHandlers.ts` lines ~210, 356, 658, 669, 687, 704) and fails when the bot does not run as root. Replace with one constant: `process.env.AGENT_WORKSPACE || os.homedir()`. Create the directory if it is missing before listing.
3. **Folder selector overflow.** A directory with hundreds of subfolders builds a keyboard Telegram rejects. Show at most 40 directories and add a "… N more not shown" line to the message text. (Paging is not needed yet.)
4. **Model list duplication.** The model array exists in both `modelSelectionHandler` and `selectModelHandler`. Move it to one exported `agentModels` array in `core/keyboards.ts` and use it in both.
5. **Stale help.** Rewrite the `/help` text in `bot.ts`: remove the "New Telegram Features" paragraph (those features do not exist in this bot) and list the real menu items.
6. **Unused state.** Remove `awaiting_chat_message` from `UserState` if grep confirms nothing references it.

**Test.** None (no new logic beyond a slice). `npm run build` must pass.

---

## Plan 5 — send files to the agent, get files back

**Why.** From a phone, the most common missing step is "here is a screenshot / log / config, use it" and "send me the file you just made".

**Build — upload.**

1. `botHandlers/generalHandlers.ts`, `messagesHandler`: before the `text`-based routing, if the message has `document` or `photo` and the user is admin, call a new `fileUploadHandler(ctx)`. Non-admins get the usual access-denied reply.
2. `fileUploadHandler` in `agentHandlers.ts`:
   - target directory = `activeProjectPath` or `AGENT_WORKSPACE`;
   - `let file = await ctx.getFile()`; refuse with a clear message if `file.file_size` is over 20 MB (the Bot API download limit);
   - download from `https://api.telegram.org/file/bot<BOT_TOKEN>/<file.file_path>` (use `PROXY_TELEGRAM_API` as the root when it is set) with the built-in `fetch`, and write it with `fs.promises.writeFile`. Put the download + write in a new `saveTelegramFile(url, destPath)` in `services/agentService.ts`;
   - filename: `document.file_name` reduced to its `path.basename`, or `photo-<timestamp>.jpg` for photos. If the name already exists, prefix a timestamp instead of overwriting;
   - reply with the saved path;
   - if the user is in `UserState.chat`: build the prompt `"I uploaded the file <saved path>.\n\n<caption, if any>"` and run it through the same code path as a chat message. To do that, split `chatMessageHandler` into the thin handler and a `runAgentPrompt(ctx, userId, prompt)` function that both call.

**Build — download.**

3. New command `/get <path>` in `bot.ts` (admin-checked) → `getFileHandler`. Resolve a relative path against `activeProjectPath` / `AGENT_WORKSPACE`. Reply with `ctx.replyWithDocument(new InputFile(resolvedPath))`. Refuse directories, missing files, and files over 50 MB (Bot API upload limit) with clear messages. Add `/get` to `setMyCommands`.

No path sandboxing: the admin can already read any file through Execute Command, so confining `/get` would add code without adding safety. Do apply `path.basename` on uploads so a crafted filename cannot write outside the target directory.

**Test.** Extract the upload filename logic to `core/telegramText.ts` as `safeUploadName(name, existingNames, now)` and test: `../../etc/passwd` becomes `passwd`; a name already in `existingNames` gets a prefix; missing name yields `photo-<now>.jpg`.

---

## Plan 6 — task history you can use

**Why.** Task History shows the last commands cut to 50 chars and no output. On a phone, re-running a command means retyping it.

**Build.**

1. `services/taskDbServices.ts`: add `getTaskById(id, userId)` (filter on `userId` too, so one admin cannot read another's task by guessing an id).
2. `taskHistoryHandler`: keep the list text, add one inline button per task: `#<id>` → `task_view_<id>`. Show the last 10.
3. `task_view_<id>` → `taskViewHandler`: show command, status, project, timestamps and output using `replyLongText` from plan 2, with buttons `🔁 Run again` → `task_rerun_<id>` and `🔙 Back` → `task_list`.
4. `task_rerun_<id>` → load the task and run its command through the same function as `handleCommandExecution`. Split that handler into the thin handler plus `runCommandForUser(ctx, userId, command)` so both call it. The re-run uses the **current** active project, and the reply says which directory it ran in.
5. Route `task_view_`, `task_rerun_`, `task_list` in `callBackHandler`.

Needs plan 2.

**Test.** None (routing and DB reads only).

---

## Plan 7 — long-running commands: live output and stop

**Why.** `executeCommand` uses `exec` with a 2-minute timeout and shows nothing until the end. `npm install`, builds and test suites either look frozen or get killed.

**Build.** Reuse the design from plan 1 rather than inventing a second one.

1. `services/agentService.ts`: rewrite `executeCommand(command, cwd, userId?, onProgress?)` on top of `spawn(command, { shell: true, cwd, env: getCleanEnv() })`, collecting stdout and stderr together in arrival order. Timeout 10 minutes, configurable through a new optional env var `COMMAND_TIMEOUT_MS`. Register the child in a second map `runningCommands` with `stopCommand(userId)` / `isCommandRunning(userId)`, mirroring plan 1. Keep the return shape `{ success, output, error? }`; `success` is `code === 0`.
2. Cap memory: keep only the last 1 MB of output in the buffer.
3. `runCommandForUser` (from plan 6, or `handleCommandExecution` if plan 6 is not built): send "⚡ Running…" with a `⏹ Stop` button (`cmd_stop`), edit it at most every 1.5 s with the output tail in a code block, same throttle as the chat handler. Refuse a new command while one is running for that user.
4. Make `/stop` (plan 1) stop whichever is running, agent or command.
5. Set the `AgentTask` status to `running` when it starts (the status exists in the schema but is never used) and to `failed` with error `stopped by user` when stopped.

Needs plans 1 and 2.

**Test.** One real-process test in `services/agentService.test.ts` is acceptable here because the function touches no DB: `executeCommand("echo hi")` succeeds with output `hi`; `executeCommand("exit 3")` returns `success: false`. Check first that importing `agentService.ts` does not pull in `dbContext` (it does not today).

---

## Plan 8 — conversations: new chat and resume

**Why.** There is one conversation per user. "Clear History" throws it away; there is no way to return to yesterday's session.

**Build.**

1. Schema: add to `prisma/schema.prisma`

   ```prisma
   model AgentSession {
     id             Int      @id @default(autoincrement())
     userId         BigInt
     conversationId String
     title          String
     projectPath    String?
     updatedAt      DateTime @updatedAt

     @@unique([userId, conversationId])
     @@index([userId])
   }
   ```

   Then `npx prisma generate` and `npx prisma db push`, and document the model in `AGENTS.md`.
2. New `services/sessionDbServices.ts`: `upsertSession(userId, conversationId, title, projectPath)`, `getSessions(userId, take = 10)` ordered by `updatedAt desc`, `getSessionById(id, userId)`.
3. `runAgentPrompt` (from plan 5, or `chatMessageHandler`): after a successful run, `upsertSession` with title = first 40 chars of the first prompt of that conversation (only set the title on create).
4. `chatMenuKeyboard`: rename "🗑️ Clear History" to "🆕 New Chat" (same `chat_clear` callback and behaviour), and add "🕘 Sessions" → `session_list`.
5. `session_list` → list sessions as buttons `session_open_<id>`. Opening one sets `conversationId` to the stored value, `lastOutputLength` to `0`, restores `activeProjectPath` from `projectPath`, and sets state `chat`.
6. Resume caveat: with `lastOutputLength` at `0`, the first reply after resuming may repeat earlier output, because the handler cannot know how much `agy` re-prints. Accept that and say so in the "session resumed" message. Do not try to compute it from the transcript.

**Test.** None (DB and routing only).

---

## Plan 9 — git buttons for a project

**Why.** Status, diff, pull, commit and push are the commands typed most from a phone, and typing them on a phone keyboard is slow.

**Build.**

1. `projectActionsKeyboard`: add `🌿 Git` → `paction_git_<id>`.
2. `paction_git_<id>` shows a keyboard: Status, Diff, Log, Pull, Push → `git_<action>_<id>`.
3. `git_<action>_<id>` → look the action up in a fixed map and run it in the project path through `runCommandForUser`:

   | Action | Command |
   |--------|---------|
   | `status` | `git status --short --branch` |
   | `diff` | `git diff --stat && git diff` |
   | `log` | `git log --oneline -15` |
   | `pull` | `git pull --ff-only` |
   | `push` | `git push` |

   The commands are constants; nothing from the user is interpolated. Unknown actions are ignored.
4. Commit is deliberately left to the agent or Execute Command: it needs a message, which means another state, and "ask the agent to commit" already works.

Needs plan 6 or 7 for `runCommandForUser` (otherwise call `executeCommand` directly), and plan 2 for long diffs.

**Test.** None.

---

## Plan 10 — scheduled prompts (build only if asked)

**Why.** "Run the tests every morning and tell me" is a natural use for a remote agent. It is also the largest plan here and the easiest to get wrong, so confirm with the owner before building it.

**Sketch.**

1. Schema: `Schedule { id, userId BigInt, projectPath String?, prompt Text, hour Int, minute Int, enabled Boolean, lastRunAt DateTime? }`.
2. `services/scheduleService.ts`: one `setInterval` every 60 s started from `index.ts`. For each enabled schedule whose `hour:minute` matches now (server time) and whose `lastRunAt` is not today, set `lastRunAt` first, then run `runAgyCli` with a fresh conversation and send the result with `sendTelegramMessage`. Skip the run, and say so, if `isAgentRunning(userId)`.
3. Only run for users whose `isAdmin` is still true at fire time.
4. UI: menu item "⏰ Schedules" → list / add (states `awaiting_schedule_time` as `HH:MM`, then `awaiting_schedule_prompt`) / toggle / delete.
5. A plain `HH:MM` daily time is enough. Do not add a cron parser or a cron dependency.

Needs plan 1.

**Test.** Pure function `isDue(schedule, now)` in its own file: due at the matching minute, not due if `lastRunAt` is the same day, not due when disabled.

---

## Not planned

Considered and left out on purpose. Do not build these as part of the plans above.

- **Voice messages.** Needs a speech-to-text service or model, which means a new dependency and a new secret.
- **Rendering agent output as Markdown.** Agent text is sent without `parse_mode` on purpose; arbitrary model output breaks MarkdownV2 escaping and the message then fails to send.
- **Multiple admin roles or per-user permissions.** One trusted operator is the model; `ALLOWED_USER_IDS` (plan 3) covers the real risk.
- **Webhook mode, web dashboard, i18n.** Long polling works; nothing asks for the others.
- **Deleting project files from Telegram.** Delete stays DB-only. Removing files remotely with one tap is too easy to regret; Execute Command can do it deliberately.
- **Foreign keys / Prisma relations.** Would be a migration across every table for no user-visible gain.
