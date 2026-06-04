import { Context, InlineKeyboard, Keyboard } from "grammy";
import logger from "../core/logger";
import { UserState } from "../core/enums";
import { getUserState, setUserState } from "../services/userDbServices";
import { adminGuard } from "../middlewares/adminGuard";
import { adminMenuKeyboard, adminMenuOptions } from "../core/keyboards";
import {
    startChatHandler,
    chatMessageHandler,
    projectMenuHandler,
    executeCommandHandler,
    handleCommandExecution,
    systemInfoHandler,
    taskHistoryHandler,
    handleProjectName,
    handleProjectPath,
    handleRepoUrl,
    handleClonePath,
    newProjectHandler,
    listProjectsHandler,
    selectProjectHandler,
    deleteProjectHandler,
    confirmDeleteProjectHandler,
    cloneRepoStartHandler,
    clearChatHandler,
    projectActionHandler,
} from "./agentHandlers";

export const startHandler = async (ctx: Context, start = true) => {
    let userId = ctx.from.id;

    let setState = await setUserState(userId, UserState.start);

    if (!setState.success) {
        await ctx.reply(setState.message);
        return;
    }

    let isAdmin = await adminGuard(userId);

    if (isAdmin) {
        await ctx.reply(
            "🤖 *Antigravity Agent Bot*\n\n" +
            "Welcome back, Admin\\! Choose an option:",
            {
                parse_mode: "MarkdownV2",
                reply_markup: adminMenuKeyboard(),
            }
        );
    } else {
        await ctx.reply(
            "👋 Welcome! This bot is an AI agent assistant.\n\n" +
            "⛔ You need admin access to use agent features.\n" +
            "Use /login <username> <password> to authenticate."
        );
    }
};


export const callBackHandler = async (ctx: Context) => {
    let userId = ctx.from?.id as number;
    let callbackData = ctx.callbackQuery?.data;

    logger.info(`User ${userId} sent a callback query: ${callbackData}`);

    if (!callbackData) return;

    // Check admin for all callback actions
    let isAdmin = await adminGuard(userId);
    if (!isAdmin) {
        await ctx.answerCallbackQuery({ text: "⛔ Admin access required" });
        return;
    }

    // Route callback queries
    if (callbackData === "project_new") {
        return await newProjectHandler(ctx);
    }

    if (callbackData === "project_list") {
        return await listProjectsHandler(ctx);
    }

    if (callbackData === "project_clone") {
        return await cloneRepoStartHandler(ctx);
    }

    if (callbackData === "back_menu") {
        await ctx.answerCallbackQuery();
        return await ctx.reply("🤖 Main Menu:", {
            reply_markup: adminMenuKeyboard(),
        });
    }

    if (callbackData === "chat_clear") {
        return await clearChatHandler(ctx);
    }

    if (callbackData.startsWith("project_select_")) {
        return await selectProjectHandler(ctx);
    }

    if (callbackData.startsWith("paction_")) {
        return await projectActionHandler(ctx);
    }

    if (callbackData.startsWith("confirm_delproject_")) {
        return await confirmDeleteProjectHandler(ctx);
    }

    if (callbackData.startsWith("cancel_")) {
        await ctx.answerCallbackQuery({ text: "Cancelled ✅" });
        return await ctx.reply("✅ Action cancelled.", {
            reply_markup: adminMenuKeyboard(),
        });
    }

    await ctx.answerCallbackQuery();
};

export const cancelHandler = async (ctx: Context) => {
    let userId = ctx.from.id;

    let state = await getUserState(userId);

    if (!state) {
        await ctx.reply("❌ Error getting your state.");
        return;
    }

    logger.info(`User ${userId} is trying to cancel in state: ${state}`);

    let setState = await setUserState(userId, UserState.start);

    if (!setState.success) {
        await ctx.reply(setState.message);
        return;
    }

    await startHandler(ctx);
};


export const messagesHandler = async (ctx: Context) => {
    let text = ctx.message?.text;
    let userId = ctx.from.id;

    // Handle cancel button
    if (text === "❌ Cancel") {
        return await cancelHandler(ctx);
    }

    // Handle admin menu buttons (keyboard replies)
    let isAdmin = await adminGuard(userId);

    if (isAdmin) {
        switch (text) {
            case adminMenuOptions.chat:
                return await startChatHandler(ctx);
            case adminMenuOptions.projects:
                return await projectMenuHandler(ctx);
            case adminMenuOptions.execute:
                return await executeCommandHandler(ctx);
            case adminMenuOptions.system:
                return await systemInfoHandler(ctx);
            case adminMenuOptions.tasks:
                return await taskHistoryHandler(ctx);
        }
    }

    // Handle state-based messages
    let state = await getUserState(userId);

    if (!state) {
        await ctx.reply("❌ Something went wrong.");
        return;
    }

    logger.info(`User ${userId} sent a message in state: ${state}`);

    switch (state) {
        case UserState.chat:
            if (!isAdmin) {
                return await ctx.reply("⛔ Access denied.");
            }
            return await chatMessageHandler(ctx);

        case UserState.awaiting_project_name:
            if (!isAdmin) return;
            return await handleProjectName(ctx);

        case UserState.awaiting_project_path:
            if (!isAdmin) return;
            return await handleProjectPath(ctx);

        case UserState.awaiting_repo_url:
            if (!isAdmin) return;
            return await handleRepoUrl(ctx);

        case UserState.awaiting_clone_path:
            if (!isAdmin) return;
            return await handleClonePath(ctx);

        case UserState.awaiting_command:
            if (!isAdmin) return;
            return await handleCommandExecution(ctx);

        default:
            if (isAdmin) {
                return await ctx.reply("🤖 Use the menu below to interact with the agent:", {
                    reply_markup: adminMenuKeyboard(),
                });
            }
            return await ctx.reply("⛔ You need admin access. Use /login <username> <password>");
    }
};