import path from "path";

// Pure text helpers (no DB or bot imports, so they are testable).

const TRUNCATED_PREFIX = "… (truncated, full output attached)\n";

export const tailForTelegram = (text: string, max = 4000) => {
    if (text.length <= max) return text;
    return TRUNCATED_PREFIX + text.substring(text.length - max);
};

export const isValidRepoUrl = (url: string) => /^(https?:\/\/|git@|ssh:\/\/)\S+$/.test(url);

export const safeUploadName = (name: string | undefined, existingNames: string[], now: number) => {
    let base = name ? path.basename(name) : "";
    if (!base || base === "." || base === "..") base = `photo-${now}.jpg`;
    if (existingNames.includes(base)) base = `${now}-${base}`;
    return base;
};

// MarkdownV2 escaping: plain text, and text inside backticks / code blocks.
export const escMd = (text: string) => text.replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
export const escCode = (text: string) => text.replace(/[\\`]/g, "\\$&");
