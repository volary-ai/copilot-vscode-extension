import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const TOKEN_KEY = "volary.token";
const AGENT_URL_KEY = "volary.agentUrl";

let output: vscode.OutputChannel;

function log(msg: string): void {
  const stamp = new Date().toISOString();
  output?.appendLine(`[${stamp}] ${msg}`);
}

function pluginDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "volary");
}

const BASH_SESSION_START = `curl -sfS --max-time 20 -H "Authorization: Bearer $VOLARY_TOKEN" -H 'Content-Type: application/json' --data-binary @- "$VOLARY_AGENT_URL/copilot/session-start"`;

const PS_SESSION_START = `curl.exe -sfS --max-time 20 -H "Authorization: Bearer $env:VOLARY_TOKEN" -H 'Content-Type: application/json' --data-binary '@-' "$env:VOLARY_AGENT_URL/copilot/session-start"`;

// Extracts transcript_path from the stdin event and POSTs the transcript file
// as the request body. The server returns the hook response JSON on stdout.
const BASH_STOP = `TP=$(sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p'); [ -n "$TP" ] && [ -f "$TP" ] && curl -sfS --max-time 30 -H "Authorization: Bearer $VOLARY_TOKEN" -H "Content-Type: application/json" --data-binary @"$TP" "$VOLARY_AGENT_URL/copilot/stop" || true`;

const PS_STOP = `$ErrorActionPreference='SilentlyContinue'; $evt=[Console]::In.ReadToEnd(); if ($evt -match '"transcript_path"\\s*:\\s*"([^"]+)"') { $tp=$matches[1]; if ($tp -and (Test-Path -LiteralPath $tp)) { curl.exe -sfS --max-time 30 -H "Authorization: Bearer $env:VOLARY_TOKEN" -H "Content-Type: application/json" --data-binary "@$tp" "$env:VOLARY_AGENT_URL/copilot/stop" } }`;

function buildPluginManifest(version: string): object {
  return {
    name: "volary",
    description: "Volary memory + MCP tools for GitHub Copilot",
    version,
    author: { name: "Volary AI", url: "https://volary.ai" },
    hooks: "hooks.json",
    mcpServers: ".mcp.json",
  };
}

function buildHooksConfig(token: string, agentUrl: string): object {
  const env = { VOLARY_TOKEN: token, VOLARY_AGENT_URL: agentUrl };
  return {
    hooks: {
      SessionStart: [
        {
          type: "command",
          timeout: 20,
          env,
          bash: BASH_SESSION_START,
          powershell: PS_SESSION_START,
        },
      ],
      Stop: [
        {
          type: "command",
          timeout: 30,
          env,
          bash: BASH_STOP,
          powershell: PS_STOP,
        },
      ],
    },
  };
}

function buildMcpConfig(token: string, agentUrl: string): object {
  return {
    mcpServers: {
      volary: {
        url: `${agentUrl}/v0/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
}

function writeFileSecure(p: string, contents: string): void {
  fs.writeFileSync(p, contents);
  if (process.platform !== "win32") {
    fs.chmodSync(p, 0o600);
  }
}

async function writePlugin(context: vscode.ExtensionContext): Promise<boolean> {
  const token = await context.secrets.get(TOKEN_KEY);
  const agentUrl = context.globalState.get<string>(AGENT_URL_KEY);
  if (!token || !agentUrl) {
    log(`skipped writing plugin: ${!token ? "no token" : "no agent URL"}`);
    return false;
  }

  const dir = pluginDir(context);
  fs.mkdirSync(dir, { recursive: true });
  // Clean up the scripts/ subdir left behind by the previous (file-based) layout.
  rmRecursive(path.join(dir, "scripts"));

  const version = context.extension.packageJSON.version as string;
  writeFileSecure(
    path.join(dir, "plugin.json"),
    JSON.stringify(buildPluginManifest(version), null, 2) + "\n",
  );
  writeFileSecure(
    path.join(dir, "hooks.json"),
    JSON.stringify(buildHooksConfig(token, agentUrl), null, 2) + "\n",
  );
  writeFileSecure(
    path.join(dir, ".mcp.json"),
    JSON.stringify(buildMcpConfig(token, agentUrl), null, 2) + "\n",
  );

  log(`wrote plugin → ${dir} (agent ${agentUrl})`);
  return true;
}

async function registerPluginLocation(dir: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("chat");
  const current = cfg.get<Record<string, boolean>>("pluginLocations") ?? {};
  if (current[dir] === true) return;
  const next = { ...current, [dir]: true };
  await cfg.update("pluginLocations", next, vscode.ConfigurationTarget.Global);
  log(`registered plugin location in chat.pluginLocations: ${dir}`);
}

async function unregisterPluginLocation(dir: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("chat");
  const current = cfg.get<Record<string, boolean>>("pluginLocations") ?? {};
  if (!(dir in current)) return;
  const next = { ...current };
  delete next[dir];
  const value = Object.keys(next).length ? next : undefined;
  await cfg.update("pluginLocations", value, vscode.ConfigurationTarget.Global);
  log(`removed plugin location from chat.pluginLocations: ${dir}`);
}

function rmRecursive(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function uninstall(context: vscode.ExtensionContext): Promise<void> {
  const dir = pluginDir(context);
  await unregisterPluginLocation(dir);
  rmRecursive(dir);
  await context.secrets.delete(TOKEN_KEY);
  await context.globalState.update(AGENT_URL_KEY, undefined);
  log("uninstalled: removed plugin dir, chat.pluginLocations entry, and stored credentials");
  vscode.window.showInformationMessage("Volary disconnected.");
}

// One-time cleanup of files left behind by the pre-plugin hook-file design.
function migrateLegacyFiles(): void {
  const legacy = [
    path.join(os.homedir(), ".copilot", "hooks", "volary.json"),
    path.join(os.homedir(), ".volary", "scripts", "copilot-stop.sh"),
    path.join(os.homedir(), ".volary", "scripts", "copilot-stop.ps1"),
  ];
  for (const p of legacy) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        log(`migrated: removed legacy ${p}`);
      } catch {
        /* ignore */
      }
    }
  }
  for (const d of [
    path.join(os.homedir(), ".volary", "scripts"),
    path.join(os.homedir(), ".volary"),
  ]) {
    try {
      fs.rmdirSync(d);
    } catch {
      /* not empty or missing — fine */
    }
  }
}

async function promptForAgentUrl(context: vscode.ExtensionContext): Promise<string | undefined> {
  const existing = context.globalState.get<string>(AGENT_URL_KEY) ?? "";
  const url = await vscode.window.showInputBox({
    title: "Volary agent URL",
    prompt: "e.g. https://api.volary.ai/v0/orgs/<org>/agents/<agent>",
    value: existing,
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return "Required";
      if (!/^https?:\/\//.test(t)) return "Must start with http(s)://";
      return null;
    },
  });
  if (url === undefined) return undefined;
  const trimmed = url.trim().replace(/\/+$/, "");
  await context.globalState.update(AGENT_URL_KEY, trimmed);
  return trimmed;
}

async function promptForToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const token = await vscode.window.showInputBox({
    title: "Volary agent token",
    prompt: "Paste the agent token from the Volary UI",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length > 10 ? null : "Token looks too short"),
  });
  if (token === undefined) return undefined;
  const trimmed = token.trim();
  await context.secrets.store(TOKEN_KEY, trimmed);
  return trimmed;
}

async function connect(context: vscode.ExtensionContext): Promise<boolean> {
  const ok = await writePlugin(context);
  if (!ok) return false;
  await registerPluginLocation(pluginDir(context));
  return true;
}

async function runConnectFlow(context: vscode.ExtensionContext): Promise<void> {
  const url = await promptForAgentUrl(context);
  if (!url) return;
  const token = await promptForToken(context);
  if (!token) return;
  const ok = await connect(context);
  if (ok) {
    vscode.window.showInformationMessage(
      "Volary connected. Reload the window if Copilot doesn't pick up the plugin immediately.",
    );
  }
}

async function showConnectBalloonIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  const token = await context.secrets.get(TOKEN_KEY);
  const agentUrl = context.globalState.get<string>(AGENT_URL_KEY);
  if (token && agentUrl) return;

  const choice = await vscode.window.showInformationMessage(
    "Volary isn't connected. Add your agent token to inject memory and MCP tools into Copilot.",
    "Connect",
    "Get Token",
    "Not Now",
  );
  if (choice === "Connect") {
    await runConnectFlow(context);
  } else if (choice === "Get Token") {
    vscode.env.openExternal(vscode.Uri.parse("https://app.volary.ai"));
  }
}

async function seedFromEnvIfPresent(context: vscode.ExtensionContext): Promise<boolean> {
  const token = process.env.VOLARY_TOKEN?.trim();
  const agentUrl = process.env.VOLARY_AGENT_URL?.trim().replace(/\/+$/, "");
  if (!token && !agentUrl) return false;
  if (token) await context.secrets.store(TOKEN_KEY, token);
  if (agentUrl) await context.globalState.update(AGENT_URL_KEY, agentUrl);
  return true;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Volary");
  context.subscriptions.push(output);
  log(`activating Volary v${context.extension.packageJSON.version} on ${process.platform}`);

  migrateLegacyFiles();

  const seeded = await seedFromEnvIfPresent(context);
  if (seeded) log("seeded credentials from VOLARY_TOKEN / VOLARY_AGENT_URL env");

  context.subscriptions.push(
    vscode.commands.registerCommand("volary.connect", async () => {
      await runConnectFlow(context);
    }),
    vscode.commands.registerCommand("volary.setToken", async () => {
      const t = await promptForToken(context);
      if (!t) return;
      const ok = await connect(context);
      if (ok) vscode.window.showInformationMessage("Volary token updated.");
      else vscode.window.showWarningMessage("Token saved. Set the agent URL to finish connecting.");
    }),
    vscode.commands.registerCommand("volary.setAgentUrl", async () => {
      const u = await promptForAgentUrl(context);
      if (!u) return;
      const ok = await connect(context);
      if (ok) vscode.window.showInformationMessage("Volary agent URL updated.");
      else vscode.window.showWarningMessage("Agent URL saved. Set the token to finish connecting.");
    }),
    vscode.commands.registerCommand("volary.installHook", async () => {
      const ok = await connect(context);
      if (!ok) {
        await runConnectFlow(context);
      } else {
        vscode.window.showInformationMessage("Volary plugin reinstalled.");
      }
    }),
    vscode.commands.registerCommand("volary.uninstallHook", async () => {
      await uninstall(context);
    }),
    vscode.commands.registerCommand("volary.showLogs", () => {
      output.show(true);
    }),
    context.secrets.onDidChange(async (e) => {
      if (e.key === TOKEN_KEY) {
        await connect(context);
      }
    }),
  );

  try {
    const ok = await connect(context);
    if (!ok) {
      await showConnectBalloonIfNeeded(context);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR during install: ${msg}`);
    vscode.window.showErrorMessage(`Volary: failed to install plugin: ${msg}`);
  }
}

export function deactivate(): void {}
