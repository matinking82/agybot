import { Context, InlineKeyboard } from "grammy";
import logger from "../core/logger";
import { UserState } from "../core/enums";
import { getUserState, setUserState, getUserData, setUserData } from "../services/userDbServices";
import { adminGuard } from "../middlewares/adminGuard";
import { executeCommand, cloneRepository, runAgyCli, listDirectory, getSystemInfo } from "../services/agentService";
import { addMessage, getConversationHistory, clearConversation } from "../services/conversationDbServices";
import { createProject, getProjects, getProjectById, deleteProject } from "../services/projectDbServices";
import { createTask, updateTaskStatus, getTasksByUser } from "../services/taskDbServices";
import { adminMenuKeyboard, adminMenuOptions, projectMenuKeyboard, chatMenuKeyboard, projectActionsKeyboard, cancelKeyboard, confirmKeyboard } from "../core/keyboards";


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

    // Save user message to conversation history
    await addMessage(userId, "user", text);

    // Show typing indicator and react
    try {
        await ctx.react("🤔");
    } catch (e) {
        // Ignored if reactions are not allowed or library version doesn't support it
    }
    await ctx.replyWithChatAction("typing");

    // Get conversation history for context
    let history = await getConversationHistory(userId, 20);
    let contextMessages = "";

    if (history.success && history.data) {
        contextMessages = history.data.map(m =>
            `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
        ).join("\n");
    }

    // Get active project context
    let userData = await getUserData(userId);
    let activeProjectPath = userData?.data?.activeProjectPath;

    // Build prompt with conversation context
    let prompt = contextMessages ? `Previous conversation:\n${contextMessages}\n\nUser: ${text}` : text;

    // Try to use agy CLI first, fall back to direct command execution
    let messageToEdit = await ctx.reply("🤖 Thinking...");
    
    let lastEditTime = 0;
    let result = await runAgyCli(prompt, activeProjectPath, userData?.data?.selectedModel, async (chunk) => {
        let now = Date.now();
        if (now - lastEditTime > 1500) {
            lastEditTime = now;
            try {
                let trimmed = chunk.length > 4000 ? chunk.substring(chunk.length - 4000) : chunk;
                if (trimmed.trim()) {
                    await ctx.api.editMessageText(ctx.chat!.id, messageToEdit.message_id, `🤖 ${trimmed}`);
                }
            } catch (e) {
                // Ignore edit errors (e.g. message not modified)
            }
        }
    });

    if (!result.success) {
        // Fallback: if agy is not available, provide helpful response
        let response = `⚠️ Agent couldn't process the request.\n\n`;
        response += `Error: ${result.error}\n\n`;
        response += `💡 You can still use:\n`;
        response += `• ⚡ Execute Command - to run shell commands\n`;
        response += `• 📂 Projects - to manage your projects\n`;

        await addMessage(userId, "assistant", response);
        try {
            await ctx.api.editMessageText(ctx.chat!.id, messageToEdit.message_id, response);
        } catch (e) {
            await ctx.reply(response);
        }
        return;
    }

    // Save assistant response
    await addMessage(userId, "assistant", result.output);

    try {
        await ctx.api.editMessageText(ctx.chat!.id, messageToEdit.message_id, `🤖 ${result.output}`, {
            reply_markup: chatMenuKeyboard(),
        });
    } catch (e) {
        // If edit fails, just reply anew
        await ctx.reply(`🤖 ${result.output}`, {
            reply_markup: chatMenuKeyboard(),
        });
    }
};

export const clearChatHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) return;

    let result = await clearConversation(userId);

    if (result.success) {
        await ctx.answerCallbackQuery({ text: "Chat history cleared ✅" });
        await ctx.reply("🗑️ Conversation history cleared.");
    } else {
        await ctx.answerCallbackQuery({ text: "Failed to clear history ❌" });
    }
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

    let userData = await getUserData(userId);
    let data = userData?.data || {};
    data.pendingProjectName = text;
    data.pendingOperation = "new";
    await setUserData(userId, data);

    await showFolderSelector(ctx, userId, "/root");
};

export const handleProjectPath = async (ctx: Context) => {
    // Deprecated, replaced by folder selector
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
        message += `• *${project.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n  📁 \`${project.path.replace(/[\\`]/g, '\\$&')}\`\n\n`;
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

    // Set as active project
    let userData = await getUserData(userId);
    let udata = userData?.data || {};
    udata.activeProjectPath = result.data.path;
    udata.activeProjectId = result.data.id;
    await setUserData(userId, udata);

    let listing = await listDirectory(result.data.path);

    await ctx.answerCallbackQuery();
    await ctx.reply(
        `📂 *${result.data.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n\n` +
        `📁 Path: \`${result.data.path.replace(/[\\`]/g, '\\$&')}\`\n` +
        `📅 Created: ${result.data.createdAt.toLocaleDateString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}\n\n` +
        `📋 *Contents:*\n\`\`\`\n${(listing.success ? listing.output : "Could not list directory").replace(/[\\`]/g, '\\$&')}\n\`\`\``,
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
    let text = ctx.message?.text;

    if (!text) return;

    let userData = await getUserData(userId);
    let data = userData?.data || {};
    data.pendingRepoUrl = text;
    data.pendingOperation = "clone";
    await setUserData(userId, data);

    await showFolderSelector(ctx, userId, "/root");
};

export const handleClonePath = async (ctx: Context) => {
    // Deprecated, replaced by folder selector
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

    let userData = await getUserData(userId);
    let activeProject = userData?.data?.activeProjectPath;

    let message = "⚡ *Execute Command*\n\n";
    message += "Send me a shell command to execute\\.\n";
    if (activeProject) {
        message += `\n📂 Active project: \`${activeProject.replace(/[\\`]/g, '\\$&')}\``;
    } else {
        message += `\n📂 Working directory: \`${(process.env.AGENT_WORKSPACE || "/tmp/agent-workspace").replace(/[\\`]/g, '\\$&')}\``;
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

    await ctx.replyWithChatAction("typing");

    let userData = await getUserData(userId);
    let cwd = userData?.data?.activeProjectPath;

    // Create a task record
    let taskResult = await createTask(userId, text, userData?.data?.activeProjectId);

    let result = await executeCommand(text, cwd);

    // Update task status
    if (taskResult.success && taskResult.data) {
        await updateTaskStatus(
            taskResult.data.id,
            result.success ? "completed" : "failed",
            result.output,
            result.error
        );
    }

    if (result.success) {
        await ctx.reply(
            `✅ *Command executed*\n\n` +
            `\`\`\`\n${result.output.replace(/[\\`]/g, '\\$&')}\n\`\`\``,
            {
                parse_mode: "MarkdownV2",
            }
        );
    } else {
        await ctx.reply(
            `❌ *Command failed*\n\n` +
            `\`\`\`\n${(result.error || "").replace(/[\\`]/g, '\\$&')}\n\`\`\``,
            {
                parse_mode: "MarkdownV2",
            }
        );
    }
};


// ─── Project Actions (from inline keyboards) ────────────────────────────────

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

    switch (action) {
        case "open":
            // Set as active project
            let userData = await getUserData(userId);
            let udata = userData?.data || {};
            udata.activeProjectPath = project.data.path;
            udata.activeProjectId = project.data.id;
            await setUserData(userId, udata);

            await ctx.answerCallbackQuery({ text: "Project activated ✅" });
            await ctx.reply(
                `📂 Active project set to: *${project.data.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n` +
                `📁 Path: \`${project.data.path.replace(/[\\`]/g, '\\$&')}\`\n\n` +
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
            let ud3 = await getUserData(userId);
            let d3 = ud3?.data || {};
            d3.activeProjectPath = undefined;
            d3.activeProjectId = undefined;
            await setUserData(userId, d3);
            await ctx.answerCallbackQuery({ text: "Project detached ✅" });
            await ctx.reply("🔌 Project detached. Commands will run in default workspace.", { reply_markup: adminMenuKeyboard() });
            break;

        case "cmd":
            let ud = await getUserData(userId);
            let d = ud?.data || {};
            d.activeProjectPath = project.data.path;
            d.activeProjectId = project.data.id;
            await setUserData(userId, d);

            await setUserState(userId, UserState.awaiting_command);
            await ctx.answerCallbackQuery();
            await ctx.reply(
                `⚡ Enter command to execute in *${project.data.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*:`,
                {
                    parse_mode: "MarkdownV2",
                    reply_markup: cancelKeyboard(),
                }
            );
            break;

        case "agent":
            let ud2 = await getUserData(userId);
            let d2 = ud2?.data || {};
            d2.activeProjectPath = project.data.path;
            d2.activeProjectId = project.data.id;
            await setUserData(userId, d2);

            await setUserState(userId, UserState.chat);
            await ctx.answerCallbackQuery();
            await ctx.reply(
                `🤖 Agent mode activated for *${project.data.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n\n` +
                "Send your prompt and the agent will work within this project\\.",
                {
                    parse_mode: "MarkdownV2",
                    reply_markup: chatMenuKeyboard(),
                }
            );
            break;

        default:
            await ctx.answerCallbackQuery({ text: "Unknown action" });
    }
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

export const taskHistoryHandler = async (ctx: Context) => {
    let userId = ctx.from?.id;

    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.reply("⛔ Access denied.");
        return;
    }

    let result = await getTasksByUser(userId, 10);

    if (!result.success || !result.data?.length) {
        await ctx.reply("📭 No task history found.", {
            reply_markup: adminMenuKeyboard(),
        });
        return;
    }

    let message = "📋 *Recent Tasks:*\n\n";

    for (let task of result.data) {
        let statusIcon = task.status === "completed" ? "✅" : task.status === "failed" ? "❌" : task.status === "running" ? "⏳" : "📝";
        let escapedCmd = task.command.substring(0, 50).replace(/[\\`]/g, '\\$&');
        let escapedStatus = task.status.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        let escapedDate = task.createdAt.toLocaleString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        message += `${statusIcon} \`${escapedCmd}\`\n`;
        message += `   Status: ${escapedStatus} \\| ${escapedDate}\n\n`;
    }

    await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: adminMenuKeyboard(),
    });
};

import { getDirectories } from "../services/agentService";
import path from "path";
import dbContext from "../services/dbContext";

export const showFolderSelector = async (ctx: Context, userId: number, dirPath: string) => {
    let userData = await getUserData(userId);
    let data = userData?.data || {};
    data.currentBrowsePath = dirPath;
    await setUserData(userId, data);

    let result = await getDirectories(dirPath);
    if (!result.success) {
        await ctx.reply(`❌ Failed to read directory: ${result.error}`);
        return;
    }

    let kb = new InlineKeyboard();
    let dirs = result.dirs || [];
    
    // Save dirs to state so we can reference them by index
    data.currentDirs = dirs;
    await setUserData(userId, data);

    if (dirPath !== "/") {
        kb.text("🔙 Parent Directory", "dir_up").row();
    }
    kb.text("➕ New Folder", "dir_new").row();
    kb.text("✅ Select Current Folder", "dir_select").row();

    let rowCount = 0;
    // limit to 30 dirs to avoid keyboard size limit
    for (let i = 0; i < Math.min(dirs.length, 30); i++) {
        kb.text(`📁 ${dirs[i]}`, `dir_nav_${i}`);
        rowCount++;
        if (rowCount >= 2) {
            kb.row();
            rowCount = 0;
        }
    }
    if (rowCount > 0) kb.row();

    kb.text("❌ Cancel", "cancel_folder").row();

    let msg = `📂 *Browsing:* \`${dirPath.replace(/[\\`]/g, '\\$&')}\`\n\nSelect a folder, create a new one, or select the current folder\\.`;

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
        } catch (e) {
            await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
        }
    } else {
        await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
    }
};

export const folderNavHandler = async (ctx: Context, index: number) => {
    let userId = ctx.from?.id as number;
    let userData = await getUserData(userId);
    let dirs = userData?.data?.currentDirs || [];
    let currentPath = userData?.data?.currentBrowsePath || "/root";
    
    if (index >= 0 && index < dirs.length) {
        let newPath = path.join(currentPath, dirs[index]);
        await showFolderSelector(ctx, userId, newPath);
    }
};

export const folderUpHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let userData = await getUserData(userId);
    let currentPath = userData?.data?.currentBrowsePath || "/root";
    let newPath = path.dirname(currentPath);
    await showFolderSelector(ctx, userId, newPath);
};

export const folderNewHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    await setUserState(userId, UserState.awaiting_new_folder_name);
    await ctx.answerCallbackQuery();
    await ctx.reply("📝 Enter a name for the new folder:", { reply_markup: cancelKeyboard() });
};

export const handleNewFolderName = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let text = ctx.message?.text;
    if (!text) return;
    
    let userData = await getUserData(userId);
    let currentPath = userData?.data?.currentBrowsePath || "/root";
    let newPath = path.join(currentPath, text);
    
    let mkdirResult = await executeCommand(`mkdir -p "${newPath}"`);
    if (!mkdirResult.success) {
        await ctx.reply(`❌ Failed to create directory: ${mkdirResult.error}`);
        return;
    }
    
    await setUserState(userId, UserState.start);
    await showFolderSelector(ctx, userId, newPath);
};

export const folderSelectHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let userData = await getUserData(userId);
    let data = userData?.data || {};
    let currentPath = data.currentBrowsePath || "/root";
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
        data.activeProjectPath = currentPath;
        data.activeProjectId = result.data?.id;
        await setUserData(userId, data);
        await setUserState(userId, UserState.start);
        
        await ctx.reply(`✅ Project *${projectName.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}* created\\!\n📁 Path: \`${currentPath.replace(/[\\`]/g, '\\$&')}\``, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
    } else if (operation === "clone") {
        let repoUrl = data.pendingRepoUrl;
        if (!repoUrl) return ctx.reply("❌ Missing repo URL.");
        
        await ctx.replyWithChatAction("typing");
        let result = await cloneRepository(repoUrl, currentPath);
        if (!result.success) {
            await setUserState(userId, UserState.start);
            return ctx.reply(`❌ Clone failed:\n${result.error}`);
        }
        
        let repoName = repoUrl.split("/").pop()?.replace(".git", "") || "cloned-project";
        let projectResult = await createProject(repoName, currentPath, userId, `Cloned from ${repoUrl}`);
        
        delete data.pendingRepoUrl;
        data.activeProjectPath = currentPath;
        if (projectResult.data) {
            data.activeProjectId = projectResult.data.id;
        }
        await setUserData(userId, data);
        await setUserState(userId, UserState.start);
        
        await ctx.reply(`✅ Repository cloned successfully\\!\n📦 ${repoUrl.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}\n📁 ${currentPath.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}`, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
    }
};

export const modelSelectionHandler = async (ctx: Context) => {
    let kb = new InlineKeyboard();
    let models = [
        "Gemini 3.5 Flash (Medium)",
        "Gemini 3.5 Flash (High)",
        "Gemini 3.5 Flash (Low)",
        "Gemini 3.1 Pro (Low)",
        "Gemini 3.1 Pro (High)",
        "Claude Sonnet 4.6 (Thinking)",
        "Claude Opus 4.6 (Thinking)",
        "GPT-OSS 120B (Medium)"
    ];
    
    for (let i = 0; i < models.length; i++) {
        kb.text(models[i], `model_select_${i}`).row();
    }
    
    await ctx.reply("🤖 Select an AI model to use:", { reply_markup: kb });
};

export const selectModelHandler = async (ctx: Context, index: number) => {
    let userId = ctx.from?.id as number;
    let models = [
        "Gemini 3.5 Flash (Medium)",
        "Gemini 3.5 Flash (High)",
        "Gemini 3.5 Flash (Low)",
        "Gemini 3.1 Pro (Low)",
        "Gemini 3.1 Pro (High)",
        "Claude Sonnet 4.6 (Thinking)",
        "Claude Opus 4.6 (Thinking)",
        "GPT-OSS 120B (Medium)"
    ];
    
    if (index >= 0 && index < models.length) {
        let selectedModel = models[index];
        let userData = await getUserData(userId);
        let data = userData?.data || {};
        data.selectedModel = selectedModel;
        await setUserData(userId, data);
        
        await ctx.answerCallbackQuery({ text: `Model set to ${selectedModel} ✅` });
        await ctx.reply(`🤖 Model updated to: *${selectedModel.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*`, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
    }
};

export const usageStatsHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let projectsCount = await dbContext.project.count({ where: { createdBy: userId } });
    let tasksCount = await dbContext.agentTask.count({ where: { userId } });
    let messagesCount = await dbContext.conversation.count({ where: { userId } });
    
    let msg = `📊 *Usage Quota Stats*\n\n`;
    msg += `📂 Projects Created: ${projectsCount}\n`;
    msg += `📋 Tasks Executed: ${tasksCount}\n`;
    msg += `💬 Chat Messages: ${messagesCount}\n\n`;

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0); // Use local timezone for reset
    const diffMs = tomorrow.getTime() - now.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const resetTimeString = `${hours}h ${minutes}m`;

    let models = [
        { name: "Gemini 3.5 Flash (Medium)", quota: "Unlimited" },
        { name: "Gemini 3.5 Flash (High)", quota: "Unlimited" },
        { name: "Gemini 3.5 Flash (Low)", quota: "Unlimited" },
        { name: "Gemini 3.1 Pro (Low)", quota: "Unlimited" },
        { name: "Gemini 3.1 Pro (High)", quota: "50/50" },
        { name: "Claude Sonnet 4.6 (Thinking)", quota: "50/50" },
        { name: "Claude Opus 4.6 (Thinking)", quota: "20/20" },
        { name: "GPT-OSS 120B (Medium)", quota: "Unlimited" }
    ];

    msg += `🤖 *Model Quotas*\n`;
    for (let model of models) {
        msg += `• *${model.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*: ${model.quota} \\(Resets in ${resetTimeString}\\)\n`;
    }

    msg += `\n_Note: Currently, there are no strict quota limits applied to your account\\._`;
    
    await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: adminMenuKeyboard() });
};
