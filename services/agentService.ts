import { exec, spawn } from "child_process";
import { promisify } from "util";
import logger from "../core/logger";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

const MAX_OUTPUT_LENGTH = 4000; // Telegram message limit

const truncateOutput = (output: string): string => {
    if (output.length <= MAX_OUTPUT_LENGTH) return output;
    return output.substring(0, MAX_OUTPUT_LENGTH) + "\n\n... (output truncated)";
};

export const executeCommand = async (command: string, cwd?: string): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
        let workDir = cwd || process.env.AGENT_WORKSPACE || "/tmp/agent-workspace";

        // Ensure workspace exists
        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, { recursive: true });
        }

        logger.info(`Executing command: ${command} in ${workDir}`, {
            section: "executeCommand",
        });

        let { stdout, stderr } = await execAsync(command, {
            cwd: workDir,
            timeout: 120000, // 2 minute timeout
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            env: { ...process.env, PATH: process.env.PATH },
        });

        let output = stdout || "";
        if (stderr && !output) {
            output = stderr;
        }

        return {
            success: true,
            output: truncateOutput(output.trim() || "Command executed successfully (no output)"),
        };
    } catch (error: any) {
        logger.error(error, {
            section: "executeCommand",
        });

        return {
            success: false,
            output: "",
            error: truncateOutput(error.message || "Command execution failed"),
        };
    }
};

export const cloneRepository = async (repoUrl: string, targetPath: string): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
        // Ensure parent directory exists
        let parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        logger.info(`Cloning repository: ${repoUrl} to ${targetPath}`, {
            section: "cloneRepository",
        });

        let { stdout, stderr } = await execAsync(`git clone ${repoUrl} ${targetPath}`, {
            timeout: 300000, // 5 minute timeout for cloning
            maxBuffer: 1024 * 1024 * 10,
        });

        return {
            success: true,
            output: stdout || stderr || "Repository cloned successfully",
        };
    } catch (error: any) {
        logger.error(error, {
            section: "cloneRepository",
        });

        return {
            success: false,
            output: "",
            error: error.message || "Failed to clone repository",
        };
    }
};

export const runAgyCli = async (prompt: string, cwd?: string): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
        let workDir = cwd || process.env.AGENT_WORKSPACE || "/tmp/agent-workspace";

        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, { recursive: true });
        }

        logger.info(`Running agy CLI with prompt in ${workDir}`, {
            section: "runAgyCli",
        });

        // Run agy with the prompt via stdin using --prompt flag
        let { stdout, stderr } = await execAsync(
            `echo ${JSON.stringify(prompt)} | agy --prompt -`,
            {
                cwd: workDir,
                timeout: 300000, // 5 minute timeout
                maxBuffer: 1024 * 1024 * 10,
                env: { ...process.env, PATH: process.env.PATH },
            }
        );

        let output = stdout || stderr || "No output from agy";

        return {
            success: true,
            output: truncateOutput(output.trim()),
        };
    } catch (error: any) {
        logger.error(error, {
            section: "runAgyCli",
        });

        // If agy is not found, provide helpful message
        if (error.message?.includes("not found") || error.message?.includes("ENOENT")) {
            return {
                success: false,
                output: "",
                error: "agy CLI not found. Please install it: curl -fsSL https://antigravity.google/cli/install.sh | bash",
            };
        }

        return {
            success: false,
            output: "",
            error: truncateOutput(error.message || "Failed to run agy CLI"),
        };
    }
};

export const listDirectory = async (dirPath: string): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
        if (!fs.existsSync(dirPath)) {
            return {
                success: false,
                output: "",
                error: `Directory not found: ${dirPath}`,
            };
        }

        let items = fs.readdirSync(dirPath, { withFileTypes: true });
        let listing = items.map(item => {
            let icon = item.isDirectory() ? "📁" : "📄";
            return `${icon} ${item.name}`;
        }).join("\n");

        return {
            success: true,
            output: listing || "(empty directory)",
        };
    } catch (error: any) {
        logger.error(error, {
            section: "listDirectory",
        });

        return {
            success: false,
            output: "",
            error: error.message || "Failed to list directory",
        };
    }
};

export const getSystemInfo = async (): Promise<string> => {
    try {
        let [nodeVersion, npmVersion, gitVersion, agyVersion] = await Promise.allSettled([
            execAsync("node --version"),
            execAsync("npm --version"),
            execAsync("git --version"),
            execAsync("agy --version"),
        ]);

        let info = "🖥️ System Information:\n\n";
        info += `📦 Node.js: ${nodeVersion.status === "fulfilled" ? nodeVersion.value.stdout.trim() : "not found"}\n`;
        info += `📦 npm: ${npmVersion.status === "fulfilled" ? npmVersion.value.stdout.trim() : "not found"}\n`;
        info += `📦 Git: ${gitVersion.status === "fulfilled" ? gitVersion.value.stdout.trim() : "not found"}\n`;
        info += `🤖 agy CLI: ${agyVersion.status === "fulfilled" ? agyVersion.value.stdout.trim() : "not installed"}\n`;
        info += `\n📂 Workspace: ${process.env.AGENT_WORKSPACE || "/tmp/agent-workspace"}`;

        return info;
    } catch (error: any) {
        logger.error(error, {
            section: "getSystemInfo",
        });

        return "Failed to retrieve system information";
    }
};
