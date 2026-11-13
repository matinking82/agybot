import { Context, InlineKeyboard, InputFile } from "grammy";
import path from "path";
import os from "os";
import logger from "../core/logger";
import { UserState } from "../core/enums";
import { getUserState, setUserState, getUserData, setUserData } from "../services/userDbServices";
import { adminGuard } from "../middlewares/adminGuard";
import {
    executeCommand,
    cloneRepository,
    runAgyCli,
    listDirectory,
    getDirectories,
    getSystemInfo,
    getAgyUsageQuota,
    getAgyModels,
    isAgentRunning,
    stopAgent,
    isCommandRunning,
    stopCommand,
    getWorkspace,
    makeDirectory,
    getFileStat,
    saveTelegramFile,
} from "../services/agentService";
import { addMessage, clearConversation } from "../services/conversationDbServices";
import { createProject, getProjects, getProjectById, deleteProject } from "../services/projectDbServices";
import { createTask, updateTaskStatus, getTasksByUser, getTaskById, getUsageCounts } from "../services/taskDbServices";
import { upsertSession, getSessions, getSessionById } from "../services/sessionDbServices";
import {
    adminMenuKeyboard,
    projectMenuKeyboard,
    chatMenuKeyboard,
    projectActionsKeyboard,
    cancelKeyboard,
    confirmKeyboard,
    stopKeyboard,
    gitKeyboard,
    taskViewKeyboard,
} from "../core/keyboards";
import { tailForTelegram, isValidRepoUrl, escMd, escCode } from "../core/telegramText";

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // Bot API getFile limit
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Bot API sendDocument limit
const MAX_FOLDER_BUTTONS = 40;
const MAX_STORED_MESSAGE = 16000; // Conversation.content is TEXT (64 KB); 4 bytes per char worst case

const folderRoot = () => process.env.AGENT_WORKSPACE || os.homedir();

// Sends the full text as a file when it is too long for a message (the message shows the tail).
const attachIfLong = async (ctx: Context, text: string, filename: string) => {
    if (text.length <= 4000) return;
    try {
        await ctx.replyWithDocument(new InputFile(Buffer.from(text), filename));
    } catch (error) {
        logger.error(error, { section: "attachIfLong" });
    }
};

const isNotModified = (error: any) => String(error?.description || error).includes("not modified");

// Changing the working directory also starts a new agy conversation.
const setActiveProject = async (userId: number, project: { id: number; path: string } | null) => {
    let data = (await getUserData(userId))?.data || {};
    if ((project?.path || undefined) !== data.activeProjectPath) {
        delete data.conversationId;
    }
    if (project) {
        data.activeProjectPath = project.path;
        data.activeProjectId = project.id;
    } else {
        delete data.activeProjectPath;
        delete data.activeProjectId;
    }
    await setUserData(userId, data);
};


// ─── Chat with Agent ─────────────────────────────────────────────────────────

export const startChatHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied. Admin privileges required.");
        return;
    }

    await setUserState(userId, UserState.chat);

    await ctx.reply(
        "🤖 *Agent Chat Mode*\n\n" +
        "Send me any message and I'll process it through the AI agent\\.\n" +
        "Use the buttons below for options, or just type your message\\.",
        {
            parse_mode: "MarkdownV2",
            reply_markup: chatMenuKeyboard(),
        }
    );
};

export const chatMessageHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let text = ctx.message?.text;

    if (!text) return;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    await runAgentPrompt(ctx, userId, text);
};

export const runAgentPrompt = async (ctx: Context, userId: number, prompt: string) => {
    if (isAgentRunning(userId)) {
        await ctx.reply("⏳ The agent is still working. Press Stop or wait.");
        return;
    }

    await addMessage(userId, "user", prompt.substring(0, MAX_STORED_MESSAGE));

    try {
        await ctx.react("🤔");
    } catch (e) {
        // Ignored if reactions are not allowed
    }
    await ctx.replyWithChatAction("typing");

    let data = (await getUserData(userId))?.data || {};
    let chatId = ctx.chat!.id;
    let messageToEdit = await ctx.reply("🤖 Thinking...", { reply_markup: stopKeyboard("agent_stop") });

    let lastEditTime = 0;
    let lastEdit: Promise<any> = Promise.resolve();
    let result = await runAgyCli(userId, prompt, data.activeProjectPath, data.selectedModel, data.conversationId, (progress) => {
        let now = Date.now();
        if (now - lastEditTime < 1500 || !progress.trim()) return;
        lastEditTime = now;
        lastEdit = ctx.api.editMessageText(chatId, messageToEdit.message_id, `🤖 ${tailForTelegram(progress.trim())}`, {
            reply_markup: stopKeyboard("agent_stop"),
        }).catch(() => {});
    });
    await lastEdit;

    if (result.conversationId) {
        // Re-read: the user may have changed settings while the agent was running.
        let fresh = (await getUserData(userId))?.data || {};
        if (fresh.activeProjectPath === data.activeProjectPath) {
            await setUserData(userId, { ...fresh, conversationId: result.conversationId });
            await upsertSession(userId, result.conversationId, prompt.substring(0, 40), data.activeProjectPath);
        }
    }

    let output = result.output;
    let reply: string;
    if (result.stopped) {
        reply = `⏹ Stopped.${output ? "\n\n" + output : ""}`;
    } else if (!result.success) {
        reply = `⚠️ Agent couldn't process the request.\n\nError: ${result.error}${output ? "\n\n" + output : ""}\n\n` +
            `💡 You can still use:\n• ⚡ Execute Command - to run shell commands\n• 📂 Projects - to manage your projects`;
    } else {
        reply = `🤖 ${output || "(no reply)"}`;
    }

    await addMessage(userId, "assistant", reply.substring(0, MAX_STORED_MESSAGE));

    // Agent text is sent without parse_mode on purpose: model output breaks MarkdownV2.
    try {
        await ctx.api.editMessageText(chatId, messageToEdit.message_id, tailForTelegram(reply));
    } catch (error) {
        if (!isNotModified(error)) await ctx.reply(tailForTelegram(reply));
    }
    await attachIfLong(ctx, output, "agent-output.txt");

    await ctx.reply(`✅ Agent has completed the task. You can now send messages.`, {
        reply_markup: chatMenuKeyboard(),
    });
};

export const clearChatHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    let result = await clearConversation(userId);

    let data = (await getUserData(userId))?.data || {};
    delete data.conversationId;
    await setUserData(userId, data);

    if (result.success) {
        await ctx.answerCallbackQuery({ text: "New chat ✅" });
        await ctx.reply("🆕 New chat started. Your next message opens a fresh agent conversation.");
    } else {
        await ctx.answerCallbackQuery({ text: "Failed to clear history ❌" });
    }
};

// One /stop for both: which = "agent" | "cmd" limits it to the button that was pressed.
export const stopHandler = async (ctx: Context, which?: "agent" | "cmd") => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    let stoppedAgent = which !== "cmd" ? stopAgent(userId) : false;
    let stoppedCommand = which !== "agent" ? stopCommand(userId) : false;
    let text = stoppedAgent || stoppedCommand ? "⏹ Stopping…" : "Nothing is running";

    if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text });
    } else {
        await ctx.reply(text);
    }
};


// ─── Sessions ────────────────────────────────────────────────────────────────

export const sessionListHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    await ctx.answerCallbackQuery();

    let result = await getSessions(userId);
    if (!result.data.length) {
        await ctx.reply("📭 No saved sessions yet. Chat with the agent to create one.", { reply_markup: chatMenuKeyboard() });
        return;
    }

    let data = (await getUserData(userId))?.data || {};
    let kb = new InlineKeyboard();
    for (let session of result.data) {
        let current = session.conversationId === data.conversationId ? "▶️ " : "";
        kb.text(`${current}${session.title}`, `session_open_${session.id}`).row();
    }
    kb.text("🔙 Back to Menu", "back_menu").row();

    await ctx.reply("🕘 Recent agent sessions (newest first):", { reply_markup: kb });
};

export const sessionOpenHandler = async (ctx: Context, sessionId: number) => {
    let userId = ctx.from?.id;

    let result = await getSessionById(sessionId, userId);
    if (!result.success || !result.data) {
        await ctx.answerCallbackQuery({ text: "Session not found ❌" });
        return;
    }

    let session = result.data;
    let data = (await getUserData(userId))?.data || {};
    if ((session.projectPath || undefined) !== data.activeProjectPath) {
        delete data.activeProjectId;
    }
    if (session.projectPath) {
        data.activeProjectPath = session.projectPath;
    } else {
        delete data.activeProjectPath;
    }
    data.conversationId = session.conversationId;
    await setUserData(userId, data);
    await setUserState(userId, UserState.chat);

    await ctx.answerCallbackQuery({ text: "Session resumed ✅" });
    await ctx.reply(
        `🕘 Resumed: ${session.title}\n📁 ${session.projectPath || getWorkspace()}\n\nSend a message to continue this conversation.`,
        { reply_markup: chatMenuKeyboard() }
    );
};


// ─── File transfer ───────────────────────────────────────────────────────────

export const fileUploadHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let message = ctx.message;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    let size = message.document?.file_size ?? message.photo?.[message.photo.length - 1]?.file_size ?? 0;
    if (size > MAX_DOWNLOAD_BYTES) {
        await ctx.reply("❌ File is too big. Telegram only lets bots download files up to 20 MB.");
        return;
    }

    let data = (await getUserData(userId))?.data || {};
    let targetDir = data.activeProjectPath || getWorkspace();

    let file = await ctx.getFile();
    let apiRoot = process.env.PROXY_TELEGRAM_API || "https://api.telegram.org";
    let url = `${apiRoot}/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

    let saved = await saveTelegramFile(url, targetDir, message.document?.file_name);
    if (!saved.success) {
        await ctx.reply(`❌ Failed to save file: ${saved.error}`);
        return;
    }

    await ctx.reply(`📥 Saved to ${saved.output}`);

    if (await getUserState(userId) === UserState.chat) {
        let caption = message.caption ? `\n\n${message.caption}` : "";
        await runAgentPrompt(ctx, userId, `I uploaded the file ${saved.output}.${caption}`);
    }
};

export const getFileHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    let arg = (ctx.message?.text || "").replace(/^\/get(@\S+)?\s*/, "").trim();
    if (!arg) {
        await ctx.reply("❌ Usage: /get <path>\nRelative paths start in the active project (or the workspace).");
        return;
    }

    let data = (await getUserData(userId))?.data || {};
    let resolved = path.resolve(data.activeProjectPath || getWorkspace(), arg);

    let stat = await getFileStat(resolved);
    if (!stat.success) {
        await ctx.reply(`❌ ${stat.error}: ${resolved}`);
        return;
    }
    if (!stat.isFile) {
        await ctx.reply(`❌ Not a file: ${resolved}`);
        return;
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
        await ctx.reply("❌ File is too big. Telegram only lets bots send files up to 50 MB.");
        return;
    }

    await ctx.replyWithChatAction("upload_document");
    await ctx.replyWithDocument(new InputFile(resolved));
};


// ─── Project Management ──────────────────────────────────────────────────────

export const projectMenuHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    await ctx.reply("📂 *Project Management*\n\nSelect an option:", {
        parse_mode: "MarkdownV2",
        reply_markup: projectMenuKeyboard(),
    });
};

export const newProjectHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    await setUserState(userId, UserState.awaiting_project_name);
    await ctx.answerCallbackQuery();
    await ctx.reply("📝 Enter a name for the new project:", {
        reply_markup: cancelKeyboard(),
    });
};

export const handleProjectName = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let text = ctx.message?.text;

    if (!text) return;

    let data = (await getUserData(userId))?.data || {};
    data.pendingProjectName = text;
    data.pendingOperation = "new";
    await setUserData(userId, data);

    await makeDirectory(folderRoot());
    await showFolderSelector(ctx, userId, folderRoot());
};

export const listProjectsHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery();
    }

    let result = await getProjects(userId);

    if (!result.success || !result.data?.length) {
        await ctx.reply("📭 No projects found. Create one first!", {
            reply_markup: projectMenuKeyboard(),
        });
        return;
    }

    let message = "📂 *Your Projects:*\n\n";
    let kb = new InlineKeyboard();

    for (let project of result.data) {
        message += `• *${escMd(project.name)}*\n  📁 \`${escCode(project.path)}\`\n\n`;
        kb.text(`📂 ${project.name}`, `project_select_${project.id}`).row();
    }

    kb.text("➕ New Project", "project_new").row();
    kb.text("🔙 Back to Menu", "back_menu").row();

    await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: kb,
    });
};

export const selectProjectHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let data = ctx.callbackQuery?.data;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    let projectId = parseInt(data?.split("_")[2] || "0");

    let result = await getProjectById(projectId);

    if (!result.success || !result.data) {
        await ctx.answerCallbackQuery({ text: "Project not found ❌" });
        return;
    }

    await setActiveProject(userId, result.data);

    let listing = await listDirectory(result.data.path);
    let listingText = listing.success ? listing.output : "Could not list directory";
    if (listingText.length > 3000) listingText = listingText.substring(0, 3000) + "\n…";

    await ctx.answerCallbackQuery();
    await ctx.reply(
        `📂 *${escMd(result.data.name)}*\n\n` +
        `📁 Path: \`${escCode(result.data.path)}\`\n` +
        `📅 Created: ${escMd(result.data.createdAt.toLocaleDateString())}\n\n` +
        `📋 *Contents:*\n\`\`\`\n${escCode(listingText)}\n\`\`\``,
        {
            parse_mode: "MarkdownV2",
            reply_markup: projectActionsKeyboard(projectId),
        }
    );
};

export const deleteProjectHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let data = ctx.callbackQuery?.data;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    let projectId = parseInt(data?.split("_")[2] || "0");

    await ctx.answerCallbackQuery();
    await ctx.reply("⚠️ Are you sure you want to delete this project record? (Files will NOT be deleted)", {
        reply_markup: confirmKeyboard("delproject", projectId.toString()),
    });
};

export const confirmDeleteProjectHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let data = ctx.callbackQuery?.data;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    let projectId = parseInt(data?.split("_")[2] || "0");

    let result = await deleteProject(projectId);

    await ctx.answerCallbackQuery();

    if (result.success) {
        await ctx.reply("✅ Project deleted from records.", {
            reply_markup: adminMenuKeyboard(),
        });
    } else {
        await ctx.reply(`❌ ${result.message}`);
    }
};


// ─── Clone Repository ────────────────────────────────────────────────────────

export const cloneRepoStartHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    await setUserState(userId, UserState.awaiting_repo_url);
    await ctx.answerCallbackQuery();
    await ctx.reply("🔗 Enter the repository URL to clone:\n(e.g., https://github.com/user/repo.git)", {
        reply_markup: cancelKeyboard(),
    });
};

export const handleRepoUrl = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let text = ctx.message?.text?.trim();

    if (!text) return;

    if (!isValidRepoUrl(text)) {
        await ctx.reply("❌ That doesn't look like a repository URL. Send an https://, ssh:// or git@ URL (no spaces), or press Cancel.");
        return;
    }

    let data = (await getUserData(userId))?.data || {};
    data.pendingRepoUrl = text;
    data.pendingOperation = "clone";
    await setUserData(userId, data);

    await makeDirectory(folderRoot());
    await showFolderSelector(ctx, userId, folderRoot());
};


// ─── Execute Command ─────────────────────────────────────────────────────────

export const executeCommandHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    await setUserState(userId, UserState.awaiting_command);

    let data = (await getUserData(userId))?.data || {};
    let activeProject = data.activeProjectPath;

    let message = "⚡ *Execute Command*\n\n";
    message += "Send me a shell command to execute\\.\n";
    if (activeProject) {
        message += `\n📂 Active project: \`${escCode(activeProject)}\``;
    } else {
        message += `\n📂 Working directory: \`${escCode(getWorkspace())}\``;
    }

    await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: cancelKeyboard(),
    });
};

export const handleCommandExecution = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let text = ctx.message?.text;

    if (!text) return;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    await runCommandForUser(ctx, userId, text);
};

// Runs a shell command with live output and a Stop button. cwd defaults to the active project.
export const runCommandForUser = async (ctx: Context, userId: number, command: string, cwd?: string, projectId?: number) => {
    if (isCommandRunning(userId)) {
        await ctx.reply("⏳ A command is still running. Press Stop or wait.");
        return;
    }

    let data = (await getUserData(userId))?.data || {};
    let workDir = cwd || data.activeProjectPath || getWorkspace();
    let chatId = ctx.chat!.id;

    let taskResult = await createTask(userId, command, cwd ? projectId : data.activeProjectId);
    let taskId = taskResult.success ? taskResult.data.id : undefined;
    if (taskId) await updateTaskStatus(taskId, "running");

    let header = `⚡ Running in \`${escCode(workDir)}\``;
    let status = await ctx.reply(header, { parse_mode: "MarkdownV2", reply_markup: stopKeyboard("cmd_stop") });

    let lastEditTime = 0;
    let lastEdit: Promise<any> = Promise.resolve();
    let result = await executeCommand(command, workDir, userId, (output) => {
        let now = Date.now();
        if (now - lastEditTime < 1500 || !output.trim()) return;
        lastEditTime = now;
        lastEdit = ctx.api.editMessageText(chatId, status.message_id, `${header}\n\n\`\`\`\n${escCode(output.slice(-3500))}\n\`\`\``, {
            parse_mode: "MarkdownV2",
            reply_markup: stopKeyboard("cmd_stop"),
        }).catch(() => {});
    });
    await lastEdit;

    if (taskId) {
        await updateTaskStatus(taskId, result.success ? "completed" : "failed", result.output, result.error);
    }

    let body = result.success ? result.output : [result.error, result.output].filter(Boolean).join("\n\n");
    let title = result.success ? "✅ Command executed" : result.stopped ? "⏹ Command stopped" : "❌ Command failed";
    let shown = tailForTelegram(body, 3700);

    try {
        await ctx.api.editMessageText(chatId, status.message_id,
            `*${title}*\n📂 \`${escCode(workDir)}\`\n\n\`\`\`\n${escCode(shown)}\n\`\`\``,
            { parse_mode: "MarkdownV2" }
        );
    } catch (error) {
        // e.g. the tail cut an escape sequence: fall back to plain text
        await ctx.reply(`${title}\n📂 ${workDir}\n\n${shown}`);
    }
    await attachIfLong(ctx, body, "command-output.txt");
};


// ─── Project Actions (from inline keyboards) ────────────────────────────────

const gitCommands: Record<string, string> = {
    status: "git status --short --branch",
    diff: "git diff --stat && git diff",
    log: "git log --oneline -15",
    pull: "git pull --ff-only",
    push: "git push",
};

export const projectActionHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let data = ctx.callbackQuery?.data;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    let parts = data?.split("_") || [];
    let action = parts[1];
    let projectId = parseInt(parts[2] || "0");

    let project = await getProjectById(projectId);
    if (!project.success || !project.data) {
        await ctx.answerCallbackQuery({ text: "Project not found ❌" });
        return;
    }

    let name = escMd(project.data.name);

    switch (action) {
        case "open":
            await setActiveProject(userId, project.data);
            await ctx.answerCallbackQuery({ text: "Project activated ✅" });
            await ctx.reply(
                `📂 Active project set to: *${name}*\n` +
                `📁 Path: \`${escCode(project.data.path)}\`\n\n` +
                "All commands will now execute in this project directory\\.",
                {
                    parse_mode: "MarkdownV2",
                    reply_markup: adminMenuKeyboard(),
                }
            );
            break;

        case "delete":
            await deleteProjectHandler(ctx);
            break;

        case "detach":
            await setActiveProject(userId, null);
            await ctx.answerCallbackQuery({ text: "Project detached ✅" });
            await ctx.reply("🔌 Project detached. Commands will run in default workspace.", { reply_markup: adminMenuKeyboard() });
            break;

        case "cmd":
            await setActiveProject(userId, project.data);
            await setUserState(userId, UserState.awaiting_command);
            await ctx.answerCallbackQuery();
            await ctx.reply(`⚡ Enter command to execute in *${name}*:`, {
                parse_mode: "MarkdownV2",
                reply_markup: cancelKeyboard(),
            });
            break;

        case "agent":
            await setActiveProject(userId, project.data);
            await setUserState(userId, UserState.chat);
            await ctx.answerCallbackQuery();
            await ctx.reply(
                `🤖 Agent mode activated for *${name}*\n\n` +
                "Send your prompt and the agent will work within this project\\.",
                {
                    parse_mode: "MarkdownV2",
                    reply_markup: chatMenuKeyboard(),
                }
            );
            break;

        case "git":
            await ctx.answerCallbackQuery();
            await ctx.reply(`🌿 Git in *${name}*:`, {
                parse_mode: "MarkdownV2",
                reply_markup: gitKeyboard(projectId),
            });
            break;

        default:
            await ctx.answerCallbackQuery({ text: "Unknown action" });
    }
};

// git_<action>_<projectId>: commands are constants, nothing from the user is interpolated.
export const gitActionHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let parts = ctx.callbackQuery?.data?.split("_") || [];
    let command = gitCommands[parts[1]];
    if (!command) return;

    let project = await getProjectById(parseInt(parts[2] || "0"));
    if (!project.success || !project.data) {
        await ctx.answerCallbackQuery({ text: "Project not found ❌" });
        return;
    }

    await ctx.answerCallbackQuery();
    await runCommandForUser(ctx, userId, command, project.data.path, project.data.id);
};


// ─── System Info ─────────────────────────────────────────────────────────────

export const systemInfoHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    await ctx.replyWithChatAction("typing");

    let info = await getSystemInfo();

    await ctx.reply(info, {
        reply_markup: adminMenuKeyboard(),
    });
};


// ─── Task History ────────────────────────────────────────────────────────────

const statusIcon = (status: string) => status === "completed" ? "✅" : status === "failed" ? "❌" : status === "running" ? "⏳" : "📝";

export const taskHistoryHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery();
    }

    let result = await getTasksByUser(userId, 10);

    if (!result.success || !result.data?.length) {
        await ctx.reply("📭 No task history found.", {
            reply_markup: adminMenuKeyboard(),
        });
        return;
    }

    let message = "📋 *Recent Tasks:*\n\n";
    let kb = new InlineKeyboard();

    for (let i = 0; i < result.data.length; i++) {
        let task = result.data[i];
        message += `${statusIcon(task.status)} *\\#${task.id}* \`${escCode(task.command.substring(0, 50))}\`\n`;
        message += `   Status: ${escMd(task.status)} \\| ${escMd(task.createdAt.toLocaleString())}\n\n`;
        kb.text(`#${task.id}`, `task_view_${task.id}`);
        if (i % 5 === 4) kb.row();
    }

    await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: kb,
    });
};

export const taskViewHandler = async (ctx: Context, taskId: number) => {
    let userId = ctx.from?.id;

    let result = await getTaskById(taskId, userId);
    if (!result.success || !result.data) {
        await ctx.answerCallbackQuery({ text: "Task not found ❌" });
        return;
    }

    await ctx.answerCallbackQuery();

    let task = result.data;
    let project = task.projectId ? (await getProjectById(task.projectId)).data : null;
    let body = [task.error, task.output].filter(Boolean).join("\n\n") || "(no output)";

    let message =
        `${statusIcon(task.status)} *Task \\#${task.id}*\n\n` +
        `\`\`\`\n${escCode(task.command.substring(0, 500))}\n\`\`\`\n` +
        `Status: ${escMd(task.status)}\n` +
        `Project: ${escMd(project?.name || "none")}\n` +
        `Started: ${escMd(task.createdAt.toLocaleString())}\n` +
        `Finished: ${escMd(task.completedAt ? task.completedAt.toLocaleString() : "-")}\n\n` +
        `\`\`\`\n${escCode(tailForTelegram(body, 2500))}\n\`\`\``;

    try {
        await ctx.reply(message, { parse_mode: "MarkdownV2", reply_markup: taskViewKeyboard(task.id) });
    } catch (error) {
        await ctx.reply(`Task #${task.id}: ${task.command}\n\n${tailForTelegram(body, 3000)}`, { reply_markup: taskViewKeyboard(task.id) });
    }
    await attachIfLong(ctx, body, "command-output.txt");
};

// Re-runs a task's command in the current active project.
export const taskRerunHandler = async (ctx: Context, taskId: number) => {
    let userId = ctx.from?.id;

    let result = await getTaskById(taskId, userId);
    if (!result.success || !result.data) {
        await ctx.answerCallbackQuery({ text: "Task not found ❌" });
        return;
    }

    await ctx.answerCallbackQuery();
    await runCommandForUser(ctx, userId, result.data.command);
};


// ─── Folder Selector ─────────────────────────────────────────────────────────

export const showFolderSelector = async (ctx: Context, userId: number, dirPath: string) => {
    let result = await getDirectories(dirPath);
    if (!result.success) {
        await ctx.reply(`❌ Failed to read directory: ${result.error}`);
        return;
    }

    let dirs = result.dirs.slice(0, MAX_FOLDER_BUTTONS);

    // Buttons reference dirs by index (callback data ≤ 64 bytes)
    let data = (await getUserData(userId))?.data || {};
    data.currentBrowsePath = dirPath;
    data.currentDirs = dirs;
    await setUserData(userId, data);

    let kb = new InlineKeyboard();

    if (dirPath !== "/") {
        kb.text("🔙 Parent Directory", "dir_up").row();
    }
    kb.text("➕ New Folder", "dir_new").row();
    kb.text("✅ Select Current Folder", "dir_select").row();

    for (let i = 0; i < dirs.length; i++) {
        kb.text(`📁 ${dirs[i]}`, `dir_nav_${i}`);
        if (i % 2 === 1) kb.row();
    }
    if (dirs.length % 2 === 1) kb.row();

    kb.text("❌ Cancel", "cancel_folder").row();

    let hidden = result.dirs.length - dirs.length;
    let msg = `📂 *Browsing:* \`${escCode(dirPath)}\`\n\nSelect a folder, create a new one, or select the current folder\\.`;
    if (hidden > 0) msg += `\n\n… ${hidden} more not shown`;

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
            return;
        } catch (e) {
            if (isNotModified(e)) return;
        }
    }
    await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
};

export const folderNavHandler = async (ctx: Context, index: number) => {
    let userId = ctx.from?.id as number;
    let data = (await getUserData(userId))?.data || {};
    let dirs = data.currentDirs || [];
    let currentPath = data.currentBrowsePath || folderRoot();

    await ctx.answerCallbackQuery();
    if (index >= 0 && index < dirs.length) {
        await showFolderSelector(ctx, userId, path.join(currentPath, dirs[index]));
    }
};

export const folderUpHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let data = (await getUserData(userId))?.data || {};
    let currentPath = data.currentBrowsePath || folderRoot();

    await ctx.answerCallbackQuery();
    await showFolderSelector(ctx, userId, path.dirname(currentPath));
};

export const folderNewHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    await setUserState(userId, UserState.awaiting_new_folder_name);
    await ctx.answerCallbackQuery();
    await ctx.reply("📝 Enter a name for the new folder:", { reply_markup: cancelKeyboard() });
};

export const handleNewFolderName = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let name = ctx.message?.text?.trim();
    if (!name) return;

    if (name.includes("/") || name === "." || name === "..") {
        await ctx.reply("❌ Invalid folder name. Send a single folder name without '/'.");
        return;
    }

    let data = (await getUserData(userId))?.data || {};
    let newPath = path.join(data.currentBrowsePath || folderRoot(), name);

    let mkdirResult = await makeDirectory(newPath);
    if (!mkdirResult.success) {
        await ctx.reply(`❌ Failed to create directory: ${mkdirResult.error}`);
        return;
    }

    await setUserState(userId, UserState.start);
    await showFolderSelector(ctx, userId, newPath);
};

export const folderSelectHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let data = (await getUserData(userId))?.data || {};
    let currentPath = data.currentBrowsePath || folderRoot();
    let operation = data.pendingOperation;

    await ctx.answerCallbackQuery();

    if (operation === "new") {
        let projectName = data.pendingProjectName;
        if (!projectName) return ctx.reply("❌ Missing project name.");

        let result = await createProject(projectName, currentPath, userId);
        if (!result.success) {
            return ctx.reply(`❌ ${result.message}`);
        }

        delete data.pendingProjectName;
        delete data.pendingOperation;
        await setUserData(userId, data);
        await setActiveProject(userId, result.data);
        await setUserState(userId, UserState.start);

        await ctx.reply(`✅ Project *${escMd(projectName)}* created\\!\n📁 Path: \`${escCode(currentPath)}\``, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
    } else if (operation === "clone") {
        let repoUrl = data.pendingRepoUrl;
        if (!repoUrl) return ctx.reply("❌ Missing repo URL.");

        let repoName = repoUrl.split(/[\/:]/).pop()?.replace(/\.git$/, "") || "cloned-project";
        // Clone into an empty selected folder, otherwise into <folder>/<repo> like `git clone` does.
        let listing = await listDirectory(currentPath);
        let targetPath = listing.output === "(empty directory)" ? currentPath : path.join(currentPath, repoName);

        await ctx.reply(`⏳ Cloning into ${targetPath}…`);
        await ctx.replyWithChatAction("typing");
        let result = await cloneRepository(repoUrl, targetPath);
        await setUserState(userId, UserState.start);
        if (!result.success) {
            return ctx.reply(`❌ Clone failed:\n${result.error}`, { reply_markup: adminMenuKeyboard() });
        }

        let projectResult = await createProject(repoName, targetPath, userId, `Cloned from ${repoUrl}`);

        delete data.pendingRepoUrl;
        delete data.pendingOperation;
        await setUserData(userId, data);
        if (projectResult.success && projectResult.data) {
            await setActiveProject(userId, projectResult.data);
        }

        await ctx.reply(`✅ Repository cloned successfully\\!\n📦 ${escMd(repoUrl)}\n📁 \`${escCode(targetPath)}\``, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
    } else {
        await ctx.reply("❌ Nothing to select a folder for. Start again from 📂 Projects.", { reply_markup: adminMenuKeyboard() });
    }
};


// ─── Models ──────────────────────────────────────────────────────────────────

export const modelSelectionHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;

    await ctx.replyWithChatAction("typing");
    let models = await getAgyModels(true);
    if (!models.length) {
        await ctx.reply("❌ Could not load the model list from agy. Is it installed and logged in?");
        return;
    }

    let selected = (await getUserData(userId))?.data?.selectedModel;
    let kb = new InlineKeyboard();
    for (let i = 0; i < models.length; i++) {
        let mark = selected === models[i].id || selected === models[i].label ? "✅ " : "";
        kb.text(`${mark}${models[i].label}`, `model_select_${i}`).row();
    }

    await ctx.reply("🤖 Select an AI model to use:", { reply_markup: kb });
};

export const selectModelHandler = async (ctx: Context, index: number) => {
    let userId = ctx.from?.id as number;
    let models = await getAgyModels();

    if (!(index >= 0 && index < models.length)) {
        await ctx.answerCallbackQuery({ text: "Model list changed, open Model Selection again" });
        return;
    }

    let model = models[index];
    let data = (await getUserData(userId))?.data || {};
    data.selectedModel = model.id;
    await setUserData(userId, data);

    await ctx.answerCallbackQuery({ text: `Model set to ${model.label} ✅` });
    await ctx.reply(`🤖 Model updated to: *${escMd(model.label)}*`, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
};


// ─── Usage Stats ─────────────────────────────────────────────────────────────

export const usageStatsHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let counts = (await getUsageCounts(userId)).data;

    let msg = `📊 *Usage Quota Stats*\n\n`;
    msg += `📂 Projects Created: ${counts.projects}\n`;
    msg += `📋 Tasks Executed: ${counts.tasks}\n`;
    msg += `💬 Chat Messages: ${counts.messages}\n\n`;
    msg += `🤖 *Model Quotas*\n`;

    let loadingMessage = await ctx.reply("⏳ Fetching actual usage quota from Agy CLI\\.\\.\\.", { parse_mode: "MarkdownV2" });

    let quotas = await getAgyUsageQuota();
    if (quotas.length > 0) {
        for (let quota of quotas) {
            msg += `• *${escMd(quota.name)}*: ${escMd(quota.quota)}\n`;
        }
    } else {
        msg += `_Unable to read quotas from agy_\n`;
    }

    msg += `\n_Note: Quota limits depend on your underlying Antigravity CLI account\\._`;

    try {
        await ctx.api.deleteMessage(ctx.chat!.id, loadingMessage.message_id);
    } catch (e) {}

    await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
};
