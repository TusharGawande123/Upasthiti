# Upasthiti starter kit – read me first

1. Install on your laptop (once): Claude Code, Git, GitHub CLI (gh),
   Node.js LTS, Python 3.12. Then run:  gh auth login
2. Unzip this kit into a new, empty folder (e.g. Documents/upasthiti).
3. Open a terminal in that folder and run:  claude
4. Open KICKOFF_PROMPT.md, copy everything, paste it into Claude Code.
   Stay in normal mode for Part A. Approve the commands Claude asks for.
5. When Claude says "Part A done", press Shift+Tab twice (Plan Mode) and type:
   Start Part B
6. Answer Claude's questions, review the plan, approve it.

Folder guide
- CLAUDE.md ............ project memory (Claude reads it every session)
- KICKOFF_PROMPT.md .... the one prompt to start everything
- docs/client/ ......... client proposal PDF + project blueprint PDF
- docs/design-refs/ .... drop design screenshots here
- .claude/agents/ ...... 8 ready subagents
- .mcp.json ............ MCP servers (Playwright, Context7)
