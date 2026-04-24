import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const HOOK_FILE_NAME = "volary.json";
const TOKEN_KEY = "volary.token";
const AGENT_URL_KEY = "volary.agentUrl";

const SCRIPTS_DIR = path.join(os.homedir(), ".volary", "scripts");
const STOP_SCRIPT_BASH = path.join(SCRIPTS_DIR, "copilot-stop.sh");
const STOP_SCRIPT_PS = path.join(SCRIPTS_DIR, "copilot-stop.ps1");

let output: vscode.OutputChannel;

function log(msg: string): void {
  const stamp = new Date().toISOString();
  output?.appendLine(`[${stamp}] ${msg}`);
}

function hookConfigPath(): string {
  return path.join(os.homedir(), ".copilot", "hooks", HOOK_FILE_NAME);
}

const BASH_SESSION_START = `curl -sfS --max-time 20 -H "Authorization: Bearer $VOLARY_TOKEN" -H 'Content-Type: application/json' --data-binary @- "$VOLARY_AGENT_URL/copilot/session-start"`;

const PS_SESSION_START = `curl.exe -sfS --max-time 20 -H "Authorization: Bearer $env:VOLARY_TOKEN" -H 'Content-Type: application/json' --data-binary '@-' "$env:VOLARY_AGENT_URL/copilot/session-start"`;

// Bash helper for Stop: reads the stdin event, pulls transcript_path out with
// sed, and POSTs the transcript file as the raw request body. If no transcript
// is available (e.g. "No workspace storage" case) the upload is skipped.
const STOP_SCRIPT_BASH_BODY = `#!/bin/sh
set -u
EVT=$(cat)
TP=$(printf '%s' "$EVT" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
if [ -n "$TP" ] && [ -f "$TP" ]; then
  curl -sfS --max-time 30 \\
    -H "Authorization: Bearer $VOLARY_TOKEN" \\
    -H "Content-Type: application/json" \\
    --data-binary @"$TP" \\
    "$VOLARY_AGENT_URL/copilot/stop" >/dev/null 2>&1 || true
fi
printf '{"continue":true}'
`;

const STOP_SCRIPT_PS_BODY = `$ErrorActionPreference = 'SilentlyContinue'
$evt = [Console]::In.ReadToEnd()
$tp = ''
if ($evt -match '"transcript_path"\\s*:\\s*"([^"]+)"') { $tp = $matches[1] }
try {
  if ($tp -and (Test-Path -LiteralPath $tp)) {
    curl.exe -sfS --max-time 30 \`
      -H "Authorization: Bearer $env:VOLARY_TOKEN" \`
      -H "Content-Type: application/json" \`
      --data-binary "@$tp" \`
      "$env:VOLARY_AGENT_URL/copilot/stop" | Out-Null
  }
} catch {}
Write-Output '{"continue":true}'
`;

function writeStopScripts(): void {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  fs.writeFileSync(STOP_SCRIPT_BASH, STOP_SCRIPT_BASH_BODY);
  fs.writeFileSync(STOP_SCRIPT_PS, STOP_SCRIPT_PS_BODY);
  if (process.platform !== "win32") {
    fs.chmodSync(STOP_SCRIPT_BASH, 0o755);
  }
}

function buildHookConfig(token: string, agentUrl: string): object {
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
          bash: `sh "${STOP_SCRIPT_BASH}"`,
          powershell: `powershell -NoProfile -ExecutionPolicy Bypass -File "${STOP_SCRIPT_PS}"`,
        },
      ],
    },
  };
}

async function writeConfigs(context: vscode.ExtensionContext): Promise<boolean> {
  const token = await context.secrets.get(TOKEN_KEY);
  const agentUrl = context.globalState.get<string>(AGENT_URL_KEY);
  if (!token || !agentUrl) {
    log(`skipped writing hook config: ${!token ? "no token" : "no agent URL"}`);
    return false;
  }

  writeStopScripts();

  const cfgPath = hookConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(buildHookConfig(token, agentUrl), null, 2) + "\n");

  if (process.platform !== "win32") {
    fs.chmodSync(cfgPath, 0o600);
  }
  log(`wrote hook config → ${cfgPath} (agent ${agentUrl})`);
  return true;
}

async function uninstall(context: vscode.ExtensionContext): Promise<void> {
  for (const p of [hookConfigPath(), STOP_SCRIPT_BASH, STOP_SCRIPT_PS]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  await context.secrets.delete(TOKEN_KEY);
  await context.globalState.update(AGENT_URL_KEY, undefined);
  log("uninstalled: removed hook config, scripts, and stored credentials");
  vscode.window.showInformationMessage("Volary disconnected.");
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

async function runConnectFlow(context: vscode.ExtensionContext): Promise<void> {
  const url = await promptForAgentUrl(context);
  if (!url) return;
  const token = await promptForToken(context);
  if (!token) return;
  const ok = await writeConfigs(context);
  if (ok) {
    vscode.window.showInformationMessage("Volary connected. Copilot sessions will now include Volary memory + MCP tools.");
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

  const seeded = await seedFromEnvIfPresent(context);
  if (seeded) log("seeded credentials from VOLARY_TOKEN / VOLARY_AGENT_URL env");

  const mcpChange = new vscode.EventEmitter<void>();
  registerMcpProvider(context, mcpChange);

  context.subscriptions.push(
    mcpChange,
    vscode.commands.registerCommand("volary.connect", async () => {
      await runConnectFlow(context);
      mcpChange.fire();
    }),
    vscode.commands.registerCommand("volary.setToken", async () => {
      const t = await promptForToken(context);
      if (t) {
        const ok = await writeConfigs(context);
        mcpChange.fire();
        if (ok) vscode.window.showInformationMessage("Volary token updated.");
        else vscode.window.showWarningMessage("Token saved. Set the agent URL to finish connecting.");
      }
    }),
    vscode.commands.registerCommand("volary.setAgentUrl", async () => {
      const u = await promptForAgentUrl(context);
      if (u) {
        const ok = await writeConfigs(context);
        mcpChange.fire();
        if (ok) vscode.window.showInformationMessage("Volary agent URL updated.");
        else vscode.window.showWarningMessage("Agent URL saved. Set the token to finish connecting.");
      }
    }),
    vscode.commands.registerCommand("volary.installHook", async () => {
      const ok = await writeConfigs(context);
      mcpChange.fire();
      if (!ok) {
        await runConnectFlow(context);
      } else {
        vscode.window.showInformationMessage("Volary hooks + MCP reinstalled.");
      }
    }),
    vscode.commands.registerCommand("volary.uninstallHook", async () => {
      await uninstall(context);
      mcpChange.fire();
    }),
    vscode.commands.registerCommand("volary.showLogs", () => {
      output.show(true);
    }),
    context.secrets.onDidChange(async (e) => {
      if (e.key === TOKEN_KEY) {
        await writeConfigs(context);
        mcpChange.fire();
      }
    }),
  );

  try {
    const wrote = await writeConfigs(context);
    if (!wrote) {
      await showConnectBalloonIfNeeded(context);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR during install: ${msg}`);
    vscode.window.showErrorMessage(`Volary: failed to install config: ${msg}`);
  }
}

function registerMcpProvider(context: vscode.ExtensionContext, change: vscode.EventEmitter<void>): void {
  // `vscode.lm.registerMcpServerDefinitionProvider` requires a recent VS Code
  // (stabilised in 1.102). Feature-detect to avoid breaking on older editors.
  const lm = vscode.lm as unknown as {
    registerMcpServerDefinitionProvider?: (
      id: string,
      provider: {
        onDidChangeMcpServerDefinitions?: vscode.Event<void>;
        provideMcpServerDefinitions: () => Thenable<unknown[]> | unknown[];
        resolveMcpServerDefinition?: (s: unknown) => Thenable<unknown> | unknown;
      },
    ) => vscode.Disposable;
  };
  const McpHttpServerDefinition = (vscode as unknown as {
    McpHttpServerDefinition?: new (label: string, uri: vscode.Uri, headers?: Record<string, string>) => unknown;
  }).McpHttpServerDefinition;

  if (!lm.registerMcpServerDefinitionProvider || !McpHttpServerDefinition) {
    return; // Running in a VS Code that doesn't support programmatic MCP yet.
  }

  const disposable = lm.registerMcpServerDefinitionProvider("volary", {
    onDidChangeMcpServerDefinitions: change.event,
    provideMcpServerDefinitions: async () => {
      const token = await context.secrets.get(TOKEN_KEY);
      const agentUrl = context.globalState.get<string>(AGENT_URL_KEY);
      if (!token || !agentUrl) return [];
      return [
        new McpHttpServerDefinition("Volary", vscode.Uri.parse(`${agentUrl}/v0/mcp`), {
          Authorization: `Bearer ${token}`,
        }),
      ];
    },
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
