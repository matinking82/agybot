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
    models: "🤖 Model Selection",
    stats: "📊 Usage Quota Stats",
};

export const adminMenuKeyboard = () => {
    let kb = new Keyboard();

    kb.text(adminMenuOptions.chat).text(adminMenuOptions.projects).row();
    kb.text(adminMenuOptions.execute).text(adminMenuOptions.system).row();
    kb.text(adminMenuOptions.tasks).text(adminMenuOptions.models).row();
    kb.text(adminMenuOptions.stats).row();

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

    kb.text("🆕 New Chat", "chat_clear").text("🕘 Sessions", "session_list").row();
    kb.text("🔙 Back to Menu", "back_menu").row();

    return kb;
};

export const projectActionsKeyboard = (projectId: number) => {
    let kb = new InlineKeyboard();

    kb.text("📂 Open", `paction_open_${projectId}`).text("🔌 Detach", `paction_detach_${projectId}`).row();
    kb.text("⚡ Run Command", `paction_cmd_${projectId}`).row();
    kb.text("🤖 Ask Agent", `paction_agent_${projectId}`).text("🌿 Git", `paction_git_${projectId}`).row();
    kb.text("🗑️ Delete", `paction_delete_${projectId}`).row();
    kb.text("🔙 Back", "project_list").row();

    return kb;
};

export const confirmKeyboard = (action: string, id: string) => {
    let kb = new InlineKeyboard();

    kb.text("✅ Yes", `confirm_${action}_${id}`).text("❌ No", `cancel_${action}_${id}`).row();

    return kb;
};

// One Stop button shown while an agent run ("agent_stop") or a command ("cmd_stop") is running.
export const stopKeyboard = (callbackData: string) => new InlineKeyboard().text("⏹ Stop", callbackData);

export const gitKeyboard = (projectId: number) => {
    let kb = new InlineKeyboard();

    kb.text("📋 Status", `git_status_${projectId}`).text("🔍 Diff", `git_diff_${projectId}`).text("📜 Log", `git_log_${projectId}`).row();
    kb.text("⬇️ Pull", `git_pull_${projectId}`).text("⬆️ Push", `git_push_${projectId}`).row();
    kb.text("🔙 Back", `project_select_${projectId}`).row();

    return kb;
};

export const taskViewKeyboard = (taskId: number) => {
    let kb = new InlineKeyboard();

    kb.text("🔁 Run again", `task_rerun_${taskId}`).text("🔙 Back", "task_list").row();

    return kb;
};
