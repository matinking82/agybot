import test from "node:test";
import assert from "node:assert";
import { tailForTelegram, isValidRepoUrl, safeUploadName } from "./telegramText";
import { parseAgyModels, parseUsageOutput } from "./agyOutput";

test("tailForTelegram", () => {
    assert.strictEqual(tailForTelegram("short"), "short");
    let long = "a".repeat(9990) + "0123456789";
    let out = tailForTelegram(long);
    assert.ok(out.length <= 4096);
    assert.ok(out.endsWith("0123456789"));
});

test("isValidRepoUrl", () => {
    assert.ok(isValidRepoUrl("https://github.com/a/b.git"));
    assert.ok(isValidRepoUrl("git@github.com:a/b.git"));
    assert.ok(!isValidRepoUrl("x; rm -rf ~"));
    assert.ok(!isValidRepoUrl("--upload-pack=x"));
    assert.ok(!isValidRepoUrl("https://github.com/a b"));
});

test("safeUploadName", () => {
    assert.strictEqual(safeUploadName("../../etc/passwd", [], 1), "passwd");
    assert.strictEqual(safeUploadName("a.txt", ["a.txt"], 5), "5-a.txt");
    assert.strictEqual(safeUploadName(undefined, [], 7), "photo-7.jpg");
});

test("parseAgyModels", () => {
    assert.deepStrictEqual(parseAgyModels("Fetching...\ngemini-x\tGemini X (High)\n"), [{ id: "gemini-x", label: "Gemini X (High)" }]);
});

test("parseUsageOutput", () => {
    let sample = "GEMINI MODELS\r\n  Models within this group: Gemini Flash\r\n\n  Weekly Limit Remaining\n[████░░] 8.89%\nRefreshes in 30h 31m\r\n\n" +
        "  Five Hour Limit Remaining\n[██████] 99.86%\nRefreshes in 4h 49m\r\n\nCLAUDE AND GPT MODELS\r\n  Weekly Limit Remaining\n[██████] 100.00%\nQuota available\r\n";
    assert.deepStrictEqual(parseUsageOutput(sample), [
        { name: "Gemini models · Weekly Limit", quota: "8.89% left · Refreshes in 30h 31m" },
        { name: "Gemini models · Five Hour Limit", quota: "99.86% left · Refreshes in 4h 49m" },
        { name: "Claude and gpt models · Weekly Limit", quota: "100.00% left · Quota available" },
    ]);
});
