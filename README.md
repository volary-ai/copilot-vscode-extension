# Volary (VS Code)

Installs a [Volary](https://volary.ai) agent plugin into GitHub Copilot: memory
at session start, Volary MCP tools during the session, and transcript upload
when the session ends.

## What it does

On activation, once you've provided an agent URL and token, the extension will 
configure hooks and mcp tooling to integrate volary's memory layer into your 
coding agent. 

You agent can recall past experience, learn from mistakes, and react to your
feedback. Transcripts will be collected to capture latent feedback and 
pertinent context that can be recalled later. 


## Getting started

1. Install the extension.
2. Run **Volary: Connect** from the command palette (Ctr-Shift-P) and paste your 
   agent URL (e.g. `https://api.volary.ai/v0/orgs/<org>/agents/<agent>`) and token 
   from [volary.ai](https://volary.ai).
3. Start a Copilot agent session — memory, MCP tools, and transcript upload
   are wired up automatically. If it doesn't pick up immediately, reload the
   window.

## Commands

- **Volary: Connect** — prompts for agent URL + token and installs the plugin.
- **Volary: Set Agent Token** — update the token only.
- **Volary: Set Agent URL** — update the URL only.
- **Volary: Reinstall Plugin** — re-renders the plugin directory (useful after
  upgrades).
- **Volary: Disconnect / Uninstall Plugin** — removes the plugin directory,
  unregisters it from `chat.pluginLocations`, and clears stored credentials.
- **Volary: Show Logs** — opens the Volary output channel for troubleshooting.

## Copilot CLI

This extension manages the VS Code side. CLI integration is coming soon. 
