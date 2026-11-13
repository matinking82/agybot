// Pure parsers for agy CLI output (no DB or bot imports, so they are testable).

// `agy models` prints one "<id>\t<label>" per line.
export const parseAgyModels = (stdout: string) => {
    let models: { id: string; label: string }[] = [];
    for (let line of stdout.split("\n")) {
        let [id, label] = line.split("\t").map(s => s?.trim());
        if (id && label) models.push({ id, label });
    }
    return models;
};

// Parses the "Models & Quota" panel of `/usage` (agy 1.5.x), ANSI codes already stripped.
// The TUI redraws, so the same limit can appear several times; the last one wins.
export const parseUsageOutput = (text: string) => {
    let results = new Map<string, string>();
    let group = "";
    let limit = "";
    let percent = "";

    for (let raw of text.split(/\r?\n|\r/)) {
        let line = raw.trim();
        if (/^[A-Z][A-Z0-9 &-]*MODELS$/.test(line)) {
            group = line.charAt(0) + line.slice(1).toLowerCase();
            limit = "";
        } else if (/Limit Remaining$/.test(line)) {
            limit = line.replace(/\s*Remaining$/, "");
            percent = "";
        } else if (limit && /[\d.]+%$/.test(line)) {
            percent = line.match(/([\d.]+%)$/)[1];
        } else if (limit && /^(Refreshes in .+|Quota available)$/.test(line)) {
            results.set(`${group} · ${limit}`, `${percent || "?"} left · ${line}`);
            limit = "";
        }
    }

    return [...results].map(([name, quota]) => ({ name, quota }));
};
