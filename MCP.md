# Connecting Open Keep to an AI assistant

Open Keep can expose your notes to an AI tool that speaks
[MCP](https://modelcontextprotocol.io) — Claude Desktop, Claude Code, and others.
Once connected, you can ask the AI to search your notes, pull one up, draft a new
one, tidy up your tags, and so on.

It is off by default and stays off until you switch it on.

## How it works

Your notes live on your device, and they stay there. Nothing is uploaded to run this.

```
AI tool  ──MCP──▶  Open Keep MCP server  ◀──local connection──  Open Keep
(Claude, etc.)     (runs on your computer)                      (your browser tab)
```

The MCP server is a small relay. It holds no notes of its own — it passes each
request to your open Open Keep tab, which answers from the notes it already has.
The connection is local to your machine (`127.0.0.1`), and it only works while:

- an Open Keep tab is open, **and**
- you have switched access on in Settings, **and**
- both sides hold the same pairing token.

Close the tab and the AI simply gets "Open Keep is not connected". Nothing
happens behind your back.

## Setup

### Claude Desktop (easiest)

1. **Get your pairing token.** In Open Keep, go to **Settings → AI Assistant
   Access**. Copy the token shown there.
2. **Download the extension.** Grab `open-keep.mcpb` from the
   [latest release](https://github.com/HotshotJacko1/Open-Keep/releases/latest).
3. **Install it.** In Claude Desktop, go to **Settings → Extensions → Advanced
   settings → Install Extension…** and pick the file you downloaded. (Dragging
   the file onto the Claude Desktop window works too. Double-clicking only works
   if Windows/macOS has associated `.mcpb` files with Claude Desktop, which isn't
   always the case — use the Settings route if nothing happens.) Claude Desktop
   will ask for the **pairing token** — paste what you copied in step 1.
4. **Switch access on.** Back in Open Keep, turn on *Let AI read notes*, and
   *Let AI create, edit & delete notes* if you want that too. The status dot
   should turn green.

You don't need Node.js or a terminal — Claude Desktop ships its own runtime for
extensions.

The extension is currently unsigned, so Claude Desktop will warn that the
publisher can't be verified. That's expected for now.

### Other MCP clients (Claude Code, Cursor, anything else)

Extensions are a Claude Desktop feature; everything else needs the server
configured by hand. You'll need [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/HotshotJacko1/Open-Keep.git
cd Open-Keep/mcp-server
npm install
npm run build
```

Then point your client at it, passing the token from **Settings → AI Assistant
Access**:

```json
{
  "mcpServers": {
    "open-keep": {
      "command": "node",
      "args": ["/absolute/path/to/Open-Keep/mcp-server/dist/index.js"],
      "env": { "OPENKEEP_MCP_TOKEN": "paste-your-token-here" }
    }
  }
}
```

On Windows, escape the backslashes: `"C:\\Users\\you\\Open-Keep\\mcp-server\\dist\\index.js"`.

## Commands

Fifteen tools, in three groups. Reading is governed by one switch in Open Keep;
creating, editing and deleting by a second, separate one.

### Reading notes

| Command | What it does |
| --- | --- |
| `list_all_notes` | Lists your notes as summaries — title, tags, pinned/archived, timestamps. Notes in the bin are excluded. |
| `search_notes` | Searches your notes by text, across both title and content. |
| `get_note` | Fetches the full content of one note by id. |

### Writing notes

| Command | What it does |
| --- | --- |
| `create_note` | Creates a note. Automatically tagged `ai-created`. |
| `update_note` | Replaces a note's title and/or content. |
| `append_to_note` | Adds text to the end of a note. |
| `prepend_to_note` | Adds text to the start of a note. |
| `delete_note` | Moves a note to the bin — recoverable for 30 days, exactly like deleting it yourself. It cannot delete permanently. |

### Tags

| Command | What it does |
| --- | --- |
| `list_tags` | Lists every tag in use across your notes. |
| `get_tag_by_id` | Looks up a single tag by name. |
| `get_notes_by_tag` | Lists every note carrying a given tag. |
| `add_tags_to_note` | Adds one or more tags to a note. |
| `remove_tags_from_note` | Removes one or more tags from a note. |
| `rename_tag` | Renames a tag everywhere it appears. |
| `delete_tag` | Removes a tag from every note carrying it. Doesn't delete any notes. |

## What keeps this safe

- **Two separate switches.** Reading and writing are granted independently. Read
  access alone means nothing can be changed.
- **Nothing is deleted permanently.** `delete_note` moves a note to the bin, the
  same as deleting it by hand. Emptying the bin is still something only you can do.
- **Every change can be undone.** Each write shows up in the **AI Activity** list
  in Settings with an Undo button, and pops a toast with Undo at the moment it
  happens.
- **Changes are labelled.** Notes the AI creates get an `ai-created` tag; notes it
  edits get `ai-edited`. You can always see what it touched.
- **Checklists are read-only.** Checklist notes can be read but not edited, so
  their structure can't get mangled.
- **Revocable.** *Disconnect AI access* in Settings turns both switches off and
  retires the pairing token, so anything paired with it stops working.

## Troubleshooting

**Status says "Not connected".** The MCP server only runs while your AI tool has
it running. Open Claude Desktop (or whichever client) and check the extension is
enabled. Also make sure at least one of the two switches is on.

**Status says "Token rejected".** The token in your AI tool doesn't match the one
in Open Keep. Copy it again from Settings → AI Assistant Access. If you clicked
*Generate a new token*, the old one stopped working and needs re-pasting.

**The AI says Open Keep isn't connected.** Your Open Keep tab is probably closed.
Open it and try again — the tab is what actually answers.

**Port 8420 is already in use.** Change the port in the extension's settings in
Claude Desktop. Open Keep will follow.

## Building the extension yourself

```bash
cd mcp-server
npm install
npm run pack:mcpb    # writes build/open-keep.mcpb
npm test             # 28 assertions covering the server end to end
```
