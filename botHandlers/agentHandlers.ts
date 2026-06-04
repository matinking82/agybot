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

    // Show typing indicator
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
    let result = await runAgyCli(prompt, activeProjectPath);

    if (!result.success) {
        // Fallback: if agy is not available, provide helpful response
        let response = `⚠️ Agent couldn't process the request.\n\n`;
        response += `Error: ${result.error}\n\n`;
        response += `💡 You can still use:\n`;
        response += `• ⚡ Execute Command - to run shell commands\n`;
        response += `• 📂 Projects - to manage your projects\n`;

        await addMessage(userId, "assistant", response);
        await ctx.reply(response);
        return;
    }

    // Save assistant response
    await addMessage(userId, "assistant", result.output);

    await ctx.reply(`🤖 ${result.output}`, {
        reply_markup: chatMenuKeyboard(),
    });
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

    // Store project name temporarily in user data
    let userData = await getUserData(userId);
    let data = userData?.data || {};
    data.pendingProjectName = text;
    await setUserData(userId, data);

    await setUserState(userId, UserState.awaiting_project_path);
    await ctx.reply(
        `📁 Project name: *${text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n\n` +
        "Enter the full path where the project should be created:\n" +
        `(e.g., ${(process.env.AGENT_WORKSPACE || "/tmp/agent-workspace").replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}/${text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')})`,
        {
            parse_mode: "MarkdownV2",
            reply_markup: cancelKeyboard(),
        }
    );
};

export const handleProjectPath = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let text = ctx.message?.text;

    if (!text) return;

    let userData = await getUserData(userId);
    let data = userData?.data || {};
    let projectName = data.pendingProjectName;

    if (!projectName) {
        await ctx.reply("❌ Something went wrong. Please start again.");
        await setUserState(userId, UserState.start);
        return;
    }

    // Create the project directory
    let mkdirResult = await executeCommand(`mkdir -p "${text}"`);
    if (!mkdirResult.success) {
        await ctx.reply(`❌ Failed to create directory:\n${mkdirResult.error}`);
        return;
    }

    // Save project to database
    let result = await createProject(projectName, text, userId);

    if (!result.success) {
        await ctx.reply(`❌ ${result.message}`);
        return;
    }

    // Clean up pending data
    delete data.pendingProjectName;
    data.activeProjectPath = text;
    data.activeProjectId = result.data?.id;
    await setUserData(userId, data);

    await setUserState(userId, UserState.start);
    await ctx.reply(
        `✅ Project *${projectName.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}* created\\!\n\n` +
        `📁 Path: \`${text}\`\n` +
        `🆔 ID: ${result.data?.id}`,
        {
            parse_mode: "MarkdownV2",
            reply_markup: adminMenuKeyboard(),
        }
    );
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
        message += `• *${project.name.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n  📁 \`${project.path}\`\n\n`;
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
        `📁 Path: \`${result.data.path}\`\n` +
        `📅 Created: ${result.data.createdAt.toLocaleDateString()}\n\n` +
        `📋 *Contents:*\n\`\`\`\n${listing.success ? listing.output : "Could not list directory"}\n\`\`\``,
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

    // Store repo URL temporarily
    let userData = await getUserData(userId);
    let data = userData?.data || {};
    data.pendingRepoUrl = text;
    await setUserData(userId, data);

    await setUserState(userId, UserState.awaiting_clone_path);
    await ctx.reply(
        "📁 Enter the target path for cloning:\n" +
        `(e.g., ${process.env.AGENT_WORKSPACE || "/tmp/agent-workspace"}/my-project)`,
        {
            reply_markup: cancelKeyboard(),
        }
    );
};

export const handleClonePath = async (ctx: Context) => {
    let userId = ctx.from?.id;
    let text = ctx.message?.text;

    if (!text) return;

    let userData = await getUserData(userId);
    let data = userData?.data || {};
    let repoUrl = data.pendingRepoUrl;

    if (!repoUrl) {
        await ctx.reply("❌ Something went wrong. Please start again.");
        await setUserState(userId, UserState.start);
        return;
    }

    await ctx.replyWithChatAction("typing");

    let result = await cloneRepository(repoUrl, text);

    if (!result.success) {
        await ctx.reply(`❌ Clone failed:\n${result.error}`);
        await setUserState(userId, UserState.start);
        return;
    }

    // Get project name from repo URL
    let repoName = repoUrl.split("/").pop()?.replace(".git", "") || "cloned-project";

    // Save as project
    let projectResult = await createProject(repoName, text, userId, `Cloned from ${repoUrl}`);

    // Clean up
    delete data.pendingRepoUrl;
    data.activeProjectPath = text;
    if (projectResult.data) {
        data.activeProjectId = projectResult.data.id;
    }
    await setUserData(userId, data);

    await setUserState(userId, UserState.start);
    await ctx.reply(
        `✅ Repository cloned successfully!\n\n` +
        `📦 ${repoUrl}\n` +
        `📁 ${text}\n\n` +
        `${result.output}`,
        {
            reply_markup: adminMenuKeyboard(),
        }
    );
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
        message += `\n📂 Active project: \`${activeProject}\``;
    } else {
        message += `\n📂 Working directory: \`${(process.env.AGENT_WORKSPACE || "/tmp/agent-workspace").replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}\``;
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
            `\`\`\`\n${result.output}\n\`\`\``,
            {
                parse_mode: "MarkdownV2",
            }
        );
    } else {
        await ctx.reply(
            `❌ *Command failed*\n\n` +
            `\`\`\`\n${result.error}\n\`\`\``,
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
                `📁 Path: \`${project.data.path}\`\n\n` +
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
        message += `${statusIcon} \`${task.command.substring(0, 50)}\`\n`;
        message += `   Status: ${task.status} | ${task.createdAt.toLocaleString()}\n\n`;
    }

    await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: adminMenuKeyboard(),
    });
};
