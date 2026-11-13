import { ChildProcess, exec, execFile, spawn } from "child_process";
import * as pty from "node-pty";
import { promisify } from "util";
import logger from "../core/logger";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { parseAgyModels, parseUsageOutput } from "../core/agyOutput";
import { safeUploadName } from "../core/telegramText";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

export const getWorkspace = () => process.env.AGENT_WORKSPACE || "/tmp/agent-workspace";

export const ensureDir = (dir: string) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

const MAX_OUTPUT_LENGTH = 4000; // Telegram message limit
const MAX_COMMAND_BUFFER = 1024 * 1024; // keep only the last 1 MB of command output

const truncateOutput = (output: string): string => {
    if (output.length <= MAX_OUTPUT_LENGTH) return output;
    return "... (output truncated)\n\n" + output.substring(output.length - MAX_OUTPUT_LENGTH);
};

const AGY_NOT_FOUND = "agy CLI not found. Please install it: curl -fsSL https://antigravity.google/cli/install.sh | bash";

// ─── Running processes (agent runs and shell commands) ──────────────────────
// shortcut: in-memory maps, so a bot restart forgets running processes; fine while children die with the bot (Docker), persist pids if that changes.
let runningAgents = new Map<number, ChildProcess>();
let runningCommands = new Map<number, ChildProcess>();
let stopRequested = new WeakSet<ChildProcess>();

// Children are spawned detached (own process group), so killing -pid also kills what they started.
const killTree = (child: ChildProcess) => {
    let kill = (signal: NodeJS.Signals) => {
        try {
            process.kill(-child.pid, signal);
        } catch (e) {
            // already gone
        }
    };
    kill("SIGTERM");
    setTimeout(() => kill("SIGKILL"), 5000);
};

const stopIn = (map: Map<number, ChildProcess>, userId: number) => {
    let child = map.get(userId);
    if (!child) return false;
    stopRequested.add(child);
    killTree(child);
    return true;
};

export const isAgentRunning = (userId: number) => runningAgents.has(userId);
export const stopAgent = (userId: number) => stopIn(runningAgents, userId);
export const isCommandRunning = (userId: number) => runningCommands.has(userId);
export const stopCommand = (userId: number) => stopIn(runningCommands, userId);

export const executeCommand = async (command: string, cwd?: string, userId?: number, onProgress?: (output: string) => void): Promise<{ success: boolean; output: string; error?: string; stopped?: boolean }> => {
    // Checked synchronously right before spawn, so two quick requests cannot both start.
    if (userId && runningCommands.has(userId)) {
        return { success: false, output: "", error: "A command is still running" };
    }
    try {
        let workDir = cwd || getWorkspace();
        ensureDir(workDir);

        let timeout = parseInt(process.env.COMMAND_TIMEOUT_MS || "") || 600000;

        logger.info(`Executing command: ${command} in ${workDir}`, {
            section: "executeCommand",
        });

        return await new Promise((resolve) => {
            let child = spawn(command, {
                shell: true,
                cwd: workDir,
                env: getCleanEnv(),
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            if (userId) runningCommands.set(userId, child);

            let output = "";
            let timedOut = false;

            let onData = (data: string) => {
                output += data;
                if (output.length > MAX_COMMAND_BUFFER) output = output.slice(-MAX_COMMAND_BUFFER);
                if (onProgress) onProgress(output);
            };
            child.stdout.setEncoding("utf8").on("data", onData);
            child.stderr.setEncoding("utf8").on("data", onData);

            let timer = setTimeout(() => {
                timedOut = true;
                killTree(child);
            }, timeout);

            let finish = (result: { success: boolean; output: string; error?: string; stopped?: boolean }) => {
                clearTimeout(timer);
                if (userId && runningCommands.get(userId) === child) runningCommands.delete(userId);
                resolve(result);
            };

            child.on("error", (error: any) => {
                logger.error(error, { section: "executeCommand" });
                finish({ success: false, output, error: truncateOutput(error.message || "Command execution failed") });
            });

            child.on("close", (code, signal) => {
                let out = output.trim();
                if (code === 0) {
                    return finish({ success: true, output: out || "Command executed successfully (no output)" });
                }
                let stopped = stopRequested.has(child);
                let error = stopped ? "Stopped by user" : timedOut ? `Timed out after ${Math.round(timeout / 1000)}s` : `Exited with code ${code ?? signal}`;
                finish({ success: false, output: out, error, stopped });
            });
        });
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
        ensureDir(path.dirname(targetPath));

        logger.info(`Cloning repository: ${repoUrl} to ${targetPath}`, {
            section: "cloneRepository",
        });

        // No shell, and "--" stops a URL starting with "-" being read as an option.
        let { stdout, stderr } = await execFileAsync("git", ["clone", "--", repoUrl, targetPath], {
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
            error: truncateOutput(error.message || "Failed to clone repository"),
        };
    }
};

// Runs one agent turn with `agy --output-format stream-json` (agy >= 1.5).
// onProgress receives the text so far: tool calls and the streamed reply.
export const runAgyCli = async (userId: number, prompt: string, cwd?: string, model?: string, conversationId?: string, onProgress?: (text: string) => void): Promise<{ success: boolean; output: string; error?: string; conversationId?: string; stopped?: boolean }> => {
    if (runningAgents.has(userId)) {
        return { success: false, output: "", error: "The agent is still working" };
    }
    try {
        let workDir = cwd || getWorkspace();
        ensureDir(workDir);

        logger.info(`Running agy CLI with prompt in ${workDir}`, {
            section: "runAgyCli",
        });

        // The prompt goes in the flag value: agy ignores stdin for "--prompt -".
        let args = ["--output-format", "stream-json", `--prompt=${prompt}`];
        if (model) args.push(`--model=${model}`);
        if (conversationId) args.push(`--conversation=${conversationId}`);

        return await new Promise((resolve) => {
            let child = spawn("agy", args, {
                cwd: workDir,
                env: getCleanEnv(),
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            runningAgents.set(userId, child);

            let pending = "";
            let progress = "";
            let plain = "";
            let stderr = "";
            let result: any = null;
            let discoveredConversationId = conversationId;
            let seenTools = new Set<number>();

            let handleLine = (line: string) => {
                let event: any;
                try {
                    event = JSON.parse(line);
                } catch (e) {
                    if (line.trim()) plain += line + "\n";
                    return;
                }

                if (event.event === "init" && event.conversation_id) {
                    discoveredConversationId = event.conversation_id;
                } else if (event.event === "result") {
                    result = event.result;
                } else if (event.event === "step_update") {
                    let step = event.step_update || {};
                    if (step.step_type === "tool" && !seenTools.has(step.step_index)) {
                        seenTools.add(step.step_index);
                        let commandLine = step.tool_info?.parameters?.CommandLine;
                        progress += `\n🔧 ${step.tool_name}${commandLine ? ": " + String(commandLine).substring(0, 100) : ""}\n`;
                    } else if (step.text_delta) {
                        progress += step.text_delta;
                    } else {
                        return;
                    }
                    if (onProgress) onProgress(progress);
                }
            };

            child.stdout.setEncoding("utf8").on("data", (data: string) => {
                pending += data;
                let lines = pending.split("\n");
                pending = lines.pop();
                for (let line of lines) handleLine(line);
            });

            child.stderr.setEncoding("utf8").on("data", (data: string) => {
                stderr += data;
            });

            let finish = (value: { success: boolean; output: string; error?: string; conversationId?: string; stopped?: boolean }) => {
                if (runningAgents.get(userId) === child) runningAgents.delete(userId);
                resolve(value);
            };

            child.on("error", (error: any) => {
                logger.error(error, { section: "runAgyCli" });
                finish({
                    success: false,
                    output: "",
                    error: error.code === "ENOENT" ? AGY_NOT_FOUND : truncateOutput(error.message || "Failed to run agy CLI"),
                });
            });

            child.on("close", (code) => {
                if (pending) handleLine(pending);
                let stopped = stopRequested.has(child);
                let ok = result?.status === "SUCCESS" && !stopped;
                finish({
                    success: ok,
                    output: (stopped ? progress : result?.response || progress).trim(),
                    error: ok ? undefined : truncateOutput(stopped ? "Stopped by user" : (result?.error || stderr.trim() || plain.trim() || `agy exited with code ${code}`)),
                    conversationId: result?.conversation_id || discoveredConversationId,
                    stopped,
                });
            });
        });
    } catch (error: any) {
        logger.error(error, {
            section: "runAgyCli",
        });

        return {
            success: false,
            output: "",
            error: truncateOutput(error.message || "Failed to run agy CLI"),
        };
    }
};

let cachedModels: { id: string; label: string }[] = [];

// Models come from `agy models`, so the list follows the installed agy version and account.
export const getAgyModels = async (refresh = false) => {
    if (cachedModels.length && !refresh) return cachedModels;
    try {
        let { stdout } = await execFileAsync("agy", ["models"], { env: getCleanEnv(), timeout: 30000 });
        cachedModels = parseAgyModels(stdout);
    } catch (error) {
        logger.error(error, { section: "getAgyModels" });
    }
    return cachedModels;
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

export const makeDirectory = async (dirPath: string): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
        ensureDir(dirPath);
        return { success: true, output: dirPath };
    } catch (error: any) {
        logger.error(error, { section: "makeDirectory" });
        return { success: false, output: "", error: error.message };
    }
};

export const getFileStat = async (filePath: string): Promise<{ success: boolean; isFile?: boolean; size?: number; error?: string }> => {
    try {
        let stat = await fs.promises.stat(filePath);
        return { success: true, isFile: stat.isFile(), size: stat.size };
    } catch (error: any) {
        return { success: false, error: error.code === "ENOENT" ? "File not found" : error.message };
    }
};

// Downloads a Telegram file into targetDir without overwriting; output is the saved path.
export const saveTelegramFile = async (url: string, targetDir: string, requestedName: string | undefined): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
        ensureDir(targetDir);

        let res = await fetch(url);
        if (!res.ok) {
            return { success: false, output: "", error: `Download failed: HTTP ${res.status}` };
        }

        let destPath = path.join(targetDir, safeUploadName(requestedName, fs.readdirSync(targetDir), Date.now()));
        await fs.promises.writeFile(destPath, Buffer.from(await res.arrayBuffer()), { flag: "wx" });

        return { success: true, output: destPath };
    } catch (error: any) {
        logger.error(error, { section: "saveTelegramFile" });
        return { success: false, output: "", error: error.message || "Failed to save file" };
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
        info += `\n📂 Workspace: ${getWorkspace()}`;

        return info;
    } catch (error: any) {
        logger.error(error, {
            section: "getSystemInfo",
        });

        return "Failed to retrieve system information";
    }
};

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

// Opens the agy TUI in a pty, sends /usage and parses the "Models & Quota" panel. Returns [] on failure.
export const getAgyUsageQuota = async (): Promise<{ name: string; quota: string }[]> => {
    return new Promise((resolve) => {
        try {
            let ptyProcess = pty.spawn("agy", [], {
                name: "xterm-color",
                cols: 100,
                rows: 50,
                cwd: os.homedir(),
                env: getCleanEnv() as Record<string, string>,
            });

            let output = "";
            let trusted = false;
            let sent = false;
            let done = false;

            let finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try {
                    ptyProcess.kill();
                } catch (e) {}
                resolve(parseUsageOutput(stripAnsi(output)));
            };
            let timer = setTimeout(finish, 20000);

            ptyProcess.onExit(finish);
            ptyProcess.onData((data) => {
                output += data;
                let plain = stripAnsi(output);
                // First run in a folder asks for trust; the default answer is "Yes".
                if (!trusted && plain.includes("Do you trust the contents")) {
                    trusted = true;
                    ptyProcess.write("\r");
                }
                if (!sent && plain.includes("for shortcuts")) {
                    sent = true;
                    setTimeout(() => ptyProcess.write("/usage\r"), 1000);
                }
                // The panel footer is drawn after all limits.
                if (sent && plain.includes("Within each group")) {
                    setTimeout(finish, 300);
                }
            });
        } catch (e) {
            logger.error(e, { section: "getAgyUsageQuota" });
            resolve([]);
        }
    });
};
