You are the lead architect and senior engineer for "Upasthiti – Smart
Attendance", a multi-plant attendance system for Sheet Shapers (a manufacturing
company in India). This is our final-year engineering sponsored project.

FIRST read, fully: CLAUDE.md, then docs/client/Sheet_Shapers_Smart_Attendance_Proposal.pdf
and docs/client/Upasthiti_Project_Blueprint.pdf. CLAUDE.md wins if they differ.

This session has two parts. Do PART A now (normal mode). Do NOT write any
application code in either part. Ask before anything that costs money, makes
the repo public, or installs from an unknown source.

==================== PART A: SET UP THE PROJECT (normal mode) ====================

A1. TOOLS CHECK. Check git, gh (GitHub CLI), node (LTS), npm/npx and python 3.12.
    Detect my OS. For anything missing, give me the exact install commands and
    wait. Run `gh auth status`; if I am not logged in, ask me to run
    `gh auth login` myself and wait.

A2. GITHUB REPO. Initialise git here (branch main), make a first commit
    "chore: project setup from starter kit", then create a PRIVATE repo with
    `gh repo create Upasthiti --private --source=. --push`. (The repo name must be exactly
    "Upasthiti", and must NOT contain the client name. If it is taken in my
    account, ask me before choosing another name.) Try to protect main
    (require a pull request + 1 approval). If GitHub says my plan does not
    allow it, tell me (I may get GitHub Pro via the Student Developer Pack) but i think will not get it as i have already tried before for other project;
    do NOT make the repo public. Create labels: spec, plan, build, review,
    bug. Create a GitHub Project board with columns Spec, Plan, Build,
    Review, Done if gh allows it.

A3. PLUGINS. From the official Anthropic marketplaces only, install:
    feature-dev, security-guidance, pr-review-toolkit (or code-review),
    commit-commands, frontend-design; and from Anthropic's skills
    marketplace: webapp-testing and the document skills (xlsx, pdf).
    First list the marketplaces to confirm the exact current names. If you
    can install them through the `claude plugin` CLI, do it; otherwise give
    me the exact `/plugin ...` commands to paste, in order, and wait.

A4. MCP SERVERS. .mcp.json already defines playwright and context7. Verify
    they work (`claude mcp list`). On native Windows, if an npx server
    fails, rewrite it to use "cmd" with args ["/c","npx",...]. Ask me before adding Figma MCP
    (only if I share Figma files) or 21st.dev Magic MCP (needs an API key).

A5. SUBAGENTS. Eight subagents already exist in .claude/agents/. Read them,
    check they match CLAUDE.md, fix anything wrong, and tell me what each
    does in one line. Do not add new ones without asking. But if you think if you can create a subagent that can make our work easy suggest me.

A6. DESIGN RESEARCH. Use the ui-designer and feature-researcher subagents
    (WebSearch/WebFetch) to study public examples of attendance/HR
    dashboards, kiosk / check-in screens and admin panels on Godly,
    Dribbble, Awwwards, Mobbin, Figma Community, 21st.dev, Aceternity UI
    and Magic UI. Also look at any screenshots I put in docs/design-refs/.
    Write docs/design-refs/inspiration.md with: links, what to borrow from
    each, and 2 design directions (colours, fonts, motion style, kiosk
    screen idea) for me to choose from.
    Important : You can also search on other design tools where you can get ui, frontend design, animations ideas for our project and can use screenshot feature to create and match the same in our project.
    Remember: kiosk users include shop-floor workers, so the kiosk must be
    big, simple, bilingual-ready and readable in daylight.

A7. Commit and push everything ("chore: tooling, agents and design research").
    Then give me a short checklist of what is done, what I must still do,
    and say: "Part A done. Switch to Plan Mode (Shift+Tab twice) and type:
    Start Part B". Then STOP.

==================== PART B: PLAN THE PROJECT (Plan Mode) ====================

B1. UNDERSTAND. Restate in your own words: the problem; the single kiosk
    channel (no phone app for now; a mobile PWA may come later if needed); permanent = face + liveness, temporary = QR +
    snapshot; the anti-proxy checks; and the salary estimate (built last,
    deductions typed by admin, no statutory calculation).

B2. TECH STACK. Analyse the whole project and recommend the best MODERN,
    current stack. Not outdated/legacy tools. Hard rule: ZERO COST - free
    and open-source, no paid APIs, usage
    fees, subscriptions or commercial licences, now or after handover.
    Cover: frontend (kiosk screen + admin dashboard), UI components +
    animation, backend, database, face detection/recognition + liveness
    (runs inside our system, CPU is fine, licence allows commercial use),
    QR generate/scan, maps + geofence editor, auth, offline kiosk queue,
    Excel/PDF reports, testing, CI. For each layer: pick, why it fits THIS
    project, licence, and 1-2 rejected alternatives with reasons.

B3. HOSTING. Team decision: free tiers first (frontend on Vercel; backend +
    database on Render, Railway or another free host), but i guess if possible deploying entire project on free tier will be better option. Docker on the
    company server later. Check today's free-tier limits and recommend the
    exact combination. Keep everything portable.

B4. ARCHITECTURE. Components, data flow for a face punch and a QR punch at
    the kiosk, kiosk registration, offline sync, and the folder structure.

B5. DATA MODEL. Tables + relationships: plants, geofences, kiosk devices,
    employees, contractors, shifts, face templates, consents, QR
    credentials, punches (+ snapshots), attendance days, regularisations,
    audit logs, salary structures (components, effective dates), monthly
    salary estimates, manual deductions.

B6. MILESTONES. Use the roadmap in CLAUDE.md (M0-M7). For each: features,
    exit criteria, and what is needed for the first demo. Salary estimate
    is last (M7). The scope is the minimum, not the limit: also suggest extra
    features that would improve the product (CLAUDE.md section 11) as a
    separate "Proposed extras" list per milestone, with effort and risk.

B7. QUESTIONS. Ask me everything you would otherwise guess (plants, gate
    devices, shifts, worker counts, languages, snapshot retention, salary
    rules). Group them; But for now I don't know number of plants, gate devices, shifts, worker counts, languages i know they are english, marathi, hindi, salary rules again i don't know right now so you can ask these letter or assume.

After I approve the plan: create docs/SRS.md (outline in the blueprint),
docs/specs/_TEMPLATE.md, docs/architecture.md,
docs/decisions/0001-tech-stack.md, fill section 4 and 9 of CLAUDE.md, commit,
push, and tell me to start M0 with the spec-writer subagent.