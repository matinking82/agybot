import { InlineKeyboard, Keyboard } from "grammy";

export const cancelOptions = {
    cancel: "❌ Cancel",
};

export const cancelKeyboard = () => {
    let kb = new Keyboard();

    for (let key in cancelOptions) {
        kb.text(cancelOptions[key]).row();
    }

    kb.resized();

    return kb;
};

export const adminMenuOptions = {
    chat: "💬 Chat with Agent",
    projects: "📂 Projects",
    execute: "⚡ Execute Command",
    system: "🖥️ System Info",
    tasks: "📋 Task History",
};

export const adminMenuKeyboard = () => {
    let kb = new Keyboard();

    kb.text(adminMenuOptions.chat).text(adminMenuOptions.projects).row();
    kb.text(adminMenuOptions.execute).text(adminMenuOptions.system).row();
    kb.text(adminMenuOptions.tasks).row();

    kb.resized();

    return kb;
};

export const projectMenuKeyboard = () => {
    let kb = new InlineKeyboard();

    kb.text("➕ New Project", "project_new").row();
    kb.text("📋 List Projects", "project_list").row();
    kb.text("📥 Clone Repository", "project_clone").row();
    kb.text("🔙 Back to Menu", "back_menu").row();

    return kb;
};

export const chatMenuKeyboard = () => {
    let kb = new InlineKeyboard();

    kb.text("🗑️ Clear History", "chat_clear").row();
    kb.text("🔙 Back to Menu", "back_menu").row();

    return kb;
};

export const projectActionsKeyboard = (projectId: number) => {
    let kb = new InlineKeyboard();

    kb.text("📂 Open", `paction_open_${projectId}`).text("🗑️ Delete", `paction_delete_${projectId}`).row();
    kb.text("⚡ Run Command", `paction_cmd_${projectId}`).row();
    kb.text("🤖 Ask Agent", `paction_agent_${projectId}`).row();
    kb.text("🔙 Back", "project_list").row();

    return kb;
};

export const confirmKeyboard = (action: string, id: string) => {
    let kb = new InlineKeyboard();

    kb.text("✅ Yes", `confirm_${action}_${id}`).text("❌ No", `cancel_${action}_${id}`).row();

    return kb;
};