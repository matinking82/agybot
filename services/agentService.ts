import { exec, spawn } from "child_process";
import { promisify } from "util";
import logger from "../core/logger";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

const execAsync = promisify(exec);

const getCleanEnv = () => {
    let cleanEnv = { ...process.env };
    
    try {
        let envPath = path.resolve(process.cwd(), ".env");
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, "utf-8");
            let envConfig = dotenv.parse(envContent);
            for (let key in envConfig) {
                delete cleanEnv[key];
            }
        }
    } catch (e) {
        // Ignore errors reading .env
    }
    
    cleanEnv.PATH = process.env.PATH;
    return cleanEnv;
};

const MAX_OUTPUT_LENGTH = 4000; // Telegram message limit

const truncateOutput = (output: string): string => {
    if (output.length <= MAX_OUTPUT_LENGTH) return output;
    return "... (output truncated)\n\n" + output.substring(output.length - MAX_OUTPUT_LENGTH);
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
            env: getCleanEnv(),
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
            env: getCleanEnv(),
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

export const runAgyCli = async (prompt: string, cwd?: string, model?: string, conversationId?: string, onProgress?: (chunk: string) => void): Promise<{ success: boolean; output: string; error?: string; conversationId?: string }> => {
    try {
        let workDir = cwd || process.env.AGENT_WORKSPACE || "/tmp/agent-workspace";
        let brainDir = require('os').homedir() + "/.gemini/antigravity-cli/brain";
        
        let existingDirs = new Set<string>();
        if (fs.existsSync(brainDir)) {
            existingDirs = new Set(fs.readdirSync(brainDir));
        }

        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, { recursive: true });
        }

        logger.info(`Running agy CLI with prompt in ${workDir}`, {
            section: "runAgyCli",
        });

        let args = ["--prompt", "-"];
        if (model) {
            args.push("--model", model);
        }
        if (conversationId) {
            args.push("--conversation", conversationId);
        }

        return await new Promise((resolve) => {
            let child = spawn("agy", args, {
                cwd: workDir,
                env: getCleanEnv(),
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (data) => {
                let chunk = data.toString();
                stdout += chunk;
                if (onProgress) {
                    onProgress(stdout);
                }
            });

            child.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            let transcriptInterval: NodeJS.Timeout;
            let checkDirInterval: NodeJS.Timeout | undefined;
            let transcriptPath = "";
            let readPosition = 0;
            let discoveredConversationId = conversationId;

            if (conversationId) {
                transcriptPath = brainDir + "/" + conversationId + "/.system_generated/logs/transcript.jsonl";
            } else {
                checkDirInterval = setInterval(() => {
                    if (!transcriptPath && fs.existsSync(brainDir)) {
                        let currentDirs = fs.readdirSync(brainDir);
                        for (let d of currentDirs) {
                            if (!existingDirs.has(d)) {
                                let p = brainDir + "/" + d + "/.system_generated/logs/transcript.jsonl";
                                if (fs.existsSync(p)) {
                                    transcriptPath = p;
                                    discoveredConversationId = d;
                                    clearInterval(checkDirInterval);
                                }
                            }
                        }
                    }
                }, 500);
            }

            transcriptInterval = setInterval(() => {
                if (transcriptPath && fs.existsSync(transcriptPath)) {
                    try {
                        let fd = fs.openSync(transcriptPath, 'r');
                        let stats = fs.fstatSync(fd);
                        if (stats.size > readPosition) {
                            let buffer = Buffer.alloc(stats.size - readPosition);
                            fs.readSync(fd, buffer, 0, buffer.length, readPosition);
                            readPosition = stats.size;
                            
                            let lines = buffer.toString().split('\n');
                            for (let line of lines) {
                                if (!line.trim()) continue;
                                try {
                                    let obj = JSON.parse(line);
                                    if (obj.type === "PLANNER_RESPONSE" && onProgress) {
                                        let updates = "";
                                        if (obj.tool_calls && obj.tool_calls.length > 0) {
                                            for (let tc of obj.tool_calls) {
                                                updates += `\n[Tool] Executed ${tc.name}`;
                                            }
                                        }
                                        if (updates) onProgress(updates + "\n");
                                    }
                                } catch (e) {}
                            }
                        }
                        fs.closeSync(fd);
                    } catch (e) {}
                }
            }, 1000);

            child.on("error", (error: any) => {
                clearInterval(checkDirInterval);
                clearInterval(transcriptInterval);
                logger.error(error, { section: "runAgyCli" });
                if (error.message?.includes("ENOENT")) {
                    resolve({
                        success: false,
                        output: "",
                        error: "agy CLI not found. Please install it: curl -fsSL https://antigravity.google/cli/install.sh | bash",
                    });
                } else {
                    resolve({
                        success: false,
                        output: "",
                        error: truncateOutput(error.message || "Failed to run agy CLI"),
                    });
                }
            });

            child.on("close", (code) => {
                clearInterval(checkDirInterval);
                clearInterval(transcriptInterval);
                let output = stdout || stderr || "No output from agy";
                resolve({
                    success: code === 0,
                    output: truncateOutput(output.trim()),
                    conversationId: discoveredConversationId
                });
            });

            child.stdin.write(prompt);
            child.stdin.end();
        });
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

export const getDirectories = async (dirPath: string): Promise<{ success: boolean; dirs: string[]; error?: string }> => {
    try {
        if (!fs.existsSync(dirPath)) {
            return { success: false, dirs: [], error: `Directory not found: ${dirPath}` };
        }
        let items = fs.readdirSync(dirPath, { withFileTypes: true });
        let dirs = items.filter(i => i.isDirectory()).map(i => i.name).sort();
        return { success: true, dirs };
    } catch (error: any) {
        logger.error(error, { section: "getDirectories" });
        return { success: false, dirs: [], error: error.message };
    }
};

export const getSystemInfo = async (): Promise<string> => {
    try {
        let [nodeVersion, npmVersion, gitVersion, agyVersion] = await Promise.allSettled([
            execAsync("node --version", { env: getCleanEnv() }),
            execAsync("npm --version", { env: getCleanEnv() }),
            execAsync("git --version", { env: getCleanEnv() }),
            execAsync("agy --version", { env: getCleanEnv() }),
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
