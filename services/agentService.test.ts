import test from "node:test";
import assert from "node:assert";
import os from "os";
import { executeCommand, isCommandRunning, stopCommand } from "./agentService";

test("executeCommand success and failure", async () => {
    let ok = await executeCommand("echo hi", os.tmpdir());
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.output, "hi");

    let bad = await executeCommand("exit 3", os.tmpdir());
    assert.strictEqual(bad.success, false);
});

test("stopCommand kills a running command", async () => {
    let run = executeCommand("sleep 30", os.tmpdir(), 42);
    await new Promise(r => setTimeout(r, 200));
    assert.ok(isCommandRunning(42));
    assert.ok(stopCommand(42));
    let result = await run;
    assert.strictEqual(result.stopped, true);
    assert.ok(!isCommandRunning(42));
});
