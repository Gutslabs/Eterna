---
name: eterna-browser
description: AI-powered browser automation using the Eterna Chrome Extension via MCP bridge. Use this skill when the agent needs to control a Chrome browser — navigating pages, clicking elements, filling forms, capturing screenshots, managing tabs, bookmarks and history, or downloading content — by connecting to the Eterna MCP bridge.
version: 1.1.0
metadata:
  openclaw:
    requires:
      bins:
        - npx
    emoji: "🌐"
    homepage: https://github.com/Gutslabs/Eterna
    os: [macos, linux, windows]
---

# Eterna Browser Control

Eterna is a Chrome extension that exposes 56 browser automation tools over the Model Context Protocol (MCP). Once connected, the agent can control any Chrome tab using natural language — clicking, typing, navigating, capturing screenshots, organizing tabs, searching history and bookmarks, downloading content, and more.

**Architecture:**
```
Agent (MCP client) ──stdio──▶ eterna-mcp-bridge ──WebSocket──▶ Eterna Chrome Extension ──▶ Browser APIs
```

---

## When to Use This Skill

Use this skill when the user wants to:

- Navigate to URLs, click links, fill forms, or interact with any web page
- Automate multi-step browser workflows
- Extract, read, or download data from web pages
- Capture screenshots of browser tabs
- Manage tabs, tab groups, bookmarks, and recently closed sessions
- Search browsing history
- Perform browser-assisted testing (accessibility, UX, regression)

---

## Prerequisites

- **Eterna Chrome extension** installed (available on the Chrome Web Store or via developer build)
- **Node.js >= 18** installed on the local machine

The user is assumed to have Eterna installed. The agent only needs to complete the two connection steps below.

---

## Step 1: Register the MCP Server

Add the following to the agent's MCP configuration. No manual installation is needed — `npx` downloads and runs `eterna-mcp-bridge` automatically.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "eterna-browser": {
      "command": "npx",
      "args": ["-y", "eterna-mcp-bridge"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "eterna-browser": {
      "command": "npx",
      "args": ["-y", "eterna-mcp-bridge"]
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add eterna-browser -- npx -y eterna-mcp-bridge
```

### VS Code Copilot (`.vscode/mcp.json`)

```json
{
  "servers": {
    "eterna-browser": {
      "command": "npx",
      "args": ["-y", "eterna-mcp-bridge"]
    }
  }
}
```

### Windsurf (`mcp_config.json`)

```json
{
  "mcpServers": {
    "eterna-browser": {
      "command": "npx",
      "args": ["-y", "eterna-mcp-bridge"]
    }
  }
}
```

### Custom port (optional)

The bridge listens on `localhost:9223` by default. To use a different port:

```json
{
  "mcpServers": {
    "eterna-browser": {
      "command": "npx",
      "args": ["-y", "eterna-mcp-bridge", "--port", "9224"]
    }
  }
}
```

Then use `ws://localhost:9224` in Step 2.

---

## Step 2: Connect the Eterna Extension to the Bridge

After the MCP server is registered and running:

1. Open Chrome and click the **Eterna** extension icon
2. Go to **Options** (or right-click the icon → "Extension options")
3. Find the **WebSocket Connection** section
4. Enter: `ws://localhost:9223`
5. Click **Connect**

The bridge and extension will handshake, and all browser tools will become available to the agent.

**Verifying the connection:** All 56 tools are always listed, but calls fail with "Eterna extension is not connected" until the extension has connected. If you see that error, follow Step 2 again — no MCP server restart is needed.

---

## Tool Usage Strategy (IMPORTANT)

Always follow this priority order to minimize token cost and latency:

### Priority 1 — `search_elements` (always try first)

Query the page's accessibility tree to find elements and get their UIDs. Fast, cheap, requires no screenshot.

```
search_elements(tabId, "{button,input,textarea,select,a}*")
```

### Priority 2 — UID-based interaction (preferred)

Use UIDs returned by `search_elements` to interact directly:

- `click(tabId, uid)` — click any element
- `fill_element_by_uid(tabId, uid, value)` — type into inputs
- `hover_element_by_uid(tabId, uid)` — reveal menus or tooltips

### Priority 3 — `capture_screenshot` + `computer` (high-cost fallback only)

Use only when `search_elements` fails after two different query attempts, or when pixel-level interaction is required (canvas, drag-and-drop, sliders).

1. `capture_screenshot(sendToLLM=true)` — see the page
2. `computer(action, coordinate)` — click/type at pixel coordinates

### Reading pages — prefer reader tools over screenshots

To read or extract content, do NOT screenshot. Use:

- `read_page()` — current tab's main content as Markdown
- `read_url(url)` — fetch and read a link without opening a tab
- `extract_structured_data(fields)` — pull named fields (price, author, date…)
- `web_search(query)` — background web search, no tab changes
- `get_youtube_transcript()` — captions of the YouTube video in the current tab

### Standard Workflow

```
get_all_tabs()
  → search_elements(tabId, "<pattern>")
  → click(tabId, uid)  OR  fill_element_by_uid(tabId, uid, value)
  → [capture_screenshot(sendToLLM=true) to verify if needed]
```

---

## Available Tool Categories

| Category | Tools | Description |
|---|---|---|
| Tab Management | 7 | Open, close, switch, inspect, ungroup tabs |
| Tab Groups | 4 | Create, update, list, dissolve tab groups |
| Recently Closed | 2 | List and restore recently closed tabs/windows |
| Bookmarks | 6 | List, search, create, update, delete bookmarks and folders |
| History | 3 | Recent history, search, most-visited (read-only) |
| UI Interaction | 8 | Click, fill, hover, upload, keyboard, coordinate-based |
| Page Content & Web | 9 | Read page/URL as Markdown, extract fields, web search, YouTube transcript, metadata, scroll, highlight |
| Memory | 2 | Remember/forget durable user facts |
| Screenshots | 3 | Capture visible tab, specific tab, or element with highlight |
| Downloads | 2 | Download images from page or chat |
| Human Intervention | 4 | Request user input mid-automation |
| Skills | 6 | Discover and run installed Eterna skills |

**Key tools by category:**

| Category | Key Tools |
|---|---|
| Tab | `get_all_tabs`, `switch_to_tab`, `create_new_tab`, `close_tab` |
| Tab Groups | `get_all_tab_groups`, `create_tab_group`, `update_tab_group` |
| Sessions | `get_recently_closed`, `restore_session` |
| Bookmarks | `search_bookmarks`, `create_bookmark`, `list_bookmarks` |
| History | `search_history`, `get_recent_history`, `get_most_visited_sites` |
| UI | `search_elements`, `click`, `fill_element_by_uid`, `computer` |
| Page & Web | `read_page`, `read_url`, `extract_structured_data`, `web_search` |
| Screenshot | `capture_screenshot`, `capture_tab_screenshot` |
| Download | `download_image`, `download_chat_images` |
| Intervention | `request_intervention`, `list_interventions` |

To load complete parameter schemas for every tool:

```
read_skill_reference("eterna-browser", "references/tools-reference.md")
```

---

## Common Patterns

### Navigate to a URL and click a button

```
create_new_tab("https://example.com")
→ search_elements(tabId, "*[Ss]ubmit*")
→ click(tabId, uid)
```

### Fill a login form

```
get_all_tabs()
→ search_elements(tabId, "{input,textbox}*")
→ fill_element_by_uid(tabId, emailUid, "user@example.com")
→ fill_element_by_uid(tabId, passwordUid, "secret")
→ search_elements(tabId, "*[Ll]ogin*")
→ click(tabId, uid)
```

### Read or extract page content

```
read_page()                                     — current tab as Markdown
read_url("https://example.com/article")         — a link, without opening a tab
extract_structured_data([{name: "price"}, ...]) — specific fields
```

### Organize a messy tab session

```
get_all_tabs()
→ create_tab_group([tabId1, tabId2], "Research", "blue")
→ create_tab_group([tabId3, tabId4], "Shopping", "green")
```

### Reopen something the user closed

```
get_recently_closed()
→ restore_session(sessionId)
```

### Visual verification

```
capture_screenshot(sendToLLM=true)
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Calls fail with "Eterna extension is not connected" | Extension not connected to bridge | Open Eterna Options → set WebSocket URL → Connect |
| Port 9223 already in use | Port conflict on machine | Use `--port 9224` in MCP config and `ws://localhost:9224` in extension |
| `search_elements` returns 0 results | Page uses canvas or non-semantic HTML | Fall back to `capture_screenshot(sendToLLM=true)` + `computer` tool |
| Connection drops frequently | Service worker sleep cycle | Eterna uses keepalive pings; reconnect extension from Options if needed |
| Tools appear but calls time out | Bridge not receiving WebSocket messages | Restart bridge: reload MCP server in agent settings |
