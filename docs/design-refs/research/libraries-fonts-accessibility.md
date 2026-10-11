# Upasthiti - UI Libraries, Inspiration, Fonts, Kiosk Accessibility (research)

Checked against live sources on 2026-10-11. "Last push" means the GitHub `pushed_at`
value from the GitHub API on that date. Star counts are rounded.
Licence rule from CLAUDE.md: zero cost, free and open-source only. If a licence is
unclear, ASK first.

---

## 0. Summary and recommendation

### Three UI foundation options

| Option | What | Licence | Pros for Upasthiti | Cons |
|---|---|---|---|---|
| **A (RECOMMENDED)** | shadcn/ui + Tailwind + Motion (core) + selected free components copied from Magic UI, Motion Primitives and Kibo UI. Icons: Lucide. Charts: shadcn charts (Recharts). | All MIT (Lucide: ISC + MIT) | The biggest ecosystem (shadcn about 125k stars, CLI 4.21.4 released 7 Oct 2026). The code is copied into our repo, so it is easy for students to read and needs no vendor lock-in after handover. Most of the "premium" kits (Magic UI, Motion Primitives, Kibo, 21st.dev) are built for shadcn, so they drop straight in. | Copied code is ours to maintain. Each copied component has to be logged with its source and licence. |
| B | coss ui (formerly Origin UI) on Base UI + Tailwind + Motion | `apps/ui` is MIT, but the rest of the repo is AGPL-3.0 | Modern Base UI primitives. It is Cal.com's official design system and was pushed today. | Mixed MIT/AGPL repo, so copying from the wrong folder is a real licence risk. Smaller ecosystem, and most animated kits assume shadcn/Radix. |
| C | Untitled UI React (React Aria) + Tailwind + Motion | MIT (GitHub `untitleduico/react`, last push 2026-10-09, about 2k stars) | Excellent accessibility from React Aria, and a matching free Figma kit. | Smaller community. The website FAQ adds "don't resell or repackage" wording on top of the MIT repo. Few animated add-ons. |

**Why A:** we have a 4-student team, a client maintainer after handover, and low-cost
kiosk tablets. Option A has the most tutorials and examples, plain copy-in code, and
MIT licences throughout. It also has the most ready-made pieces this project needs:
animated counters, a live list, a status dot, a QR render, a contribution heatmap,
charts and data tables.

### Verdict table (one line each)

| Source | Verdict |
|---|---|
| shadcn/ui | USE (foundation) |
| Magic UI (free, GitHub repo) | USE selected components. Do NOT use Magic UI Pro (paid). |
| Motion Primitives | USE selected components. Ignore the "Advanced"/pro link. |
| Kibo UI | USE selected components |
| coss ui / Origin UI | OPTIONAL. Copy only from MIT folders (`apps/ui`, `apps/origin`). |
| 21st.dev | OK per component, only if the page shows an OSI licence (MIT etc.). Never pay. |
| Motion (motion.dev) | USE the core library (MIT). Do NOT buy Motion+ ($399). |
| Aceternity UI | INSPIRATION ONLY: free components have no stated open-source licence. Ask Aceternity in writing before copying code. |
| React Bits | ASK THE TEAM: licence is "MIT + Commons Clause" (not OSI). Prefer Magic UI equivalents. |
| uiverse.io | OK for small CSS ideas (MIT). Keep the author credit comment. |
| Tremor | AVOID for new work: stagnant since joining Vercel. Use shadcn charts. |
| GSAP | REJECT: proprietary "no charge" licence, revocable and changeable by Webflow. |
| Lottie (dotlottie-web player) | OK for 2-4 tiny animations. Player is MIT; animation files are under the Lottie Simple License (check each one). |
| Rive | REJECT: runtime is MIT, but free-plan exports show a Rive splash screen and removing it is paid. |
| Lucide | USE (default icon set) |
| Tabler Icons | BACKUP when Lucide lacks an icon. The filled variants suit kiosk pictograms. |
| Phosphor | OK alternative. Slower activity in 2026. |
| Recharts | USE (via shadcn charts) |
| Apache ECharts | OPTIONAL, only if we need a heavy calendar heatmap or very large datasets |
| visx | AVOID (too low-level for a student team) |

**Performance rule for gate devices:** the kiosk already runs camera capture, face
detection and liveness on a cheap tablet. On the kiosk, only animate `transform` and
`opacity`. Do NOT use WebGL backgrounds there (React Bits backgrounds, Aceternity
shaders, Magic UI Globe/Particles/Warp). Respect `prefers-reduced-motion`. Keep the
heavy effects on the admin dashboard, which runs on office PCs.

**Licence log:** add a file such as `docs/decisions/ui-component-sources.md` listing
every copied component: name, source URL, licence, date copied. MIT requires keeping
the copyright notice, so put a one-line header comment with the source URL in each
copied file.

---

## 1. UI component and animation sources

### 1.1 shadcn/ui
- **What:** copy-into-your-repo React components (Radix primitives + Tailwind), plus
  a CLI and a registry system that other kits plug into. Also ships Blocks (login,
  sidebar, dashboard layouts) and Charts.
- **Licence:** MIT ([repo](https://github.com/shadcn-ui/ui)). There is no paid tier.
  Commercial client use is fine.
- **Maintenance:** very active. Last push 2026-10-10. CLI `shadcn@4.21.4` released
  7 Oct 2026 ([releases](https://github.com/shadcn-ui/ui/releases)). About 125k stars.
- **Cost:** 0.
- **For Upasthiti:** the base design system. Sidebar layout, Data Table (employees,
  attendance, audit log), Form + validation, Dialog/Sheet (corrections), Calendar
  (holiday calendar), Command palette (smart search), Toast/Sonner (kiosk feedback),
  Charts, dark mode tokens.
- **URL:** https://ui.shadcn.com

### 1.2 Magic UI (free vs Pro)
- **What:** about 77 animated components built for shadcn/Tailwind/Motion
  ([list](https://magicui.design/docs/components)).
- **Licence:**
  - **Free components:** MIT, per the GitHub repo
    ([magicuidesign/magicui](https://github.com/magicuidesign/magicui)). OK for
    commercial client products.
  - **Magic UI Pro:** paid (one-time; seats-based tiers) under a proprietary licence
    ([pro.magicui.design/license](https://pro.magicui.design/license)). It bans
    redistribution and sets USD 10,000 damages per unauthorised redistribution.
    **Do not use Pro.** That licence page talks about "any Magic UI Products". For
    the free components, rely on the MIT LICENSE in the GitHub repo and copy only
    from the open-source docs and repo.
- **Maintenance:** active. Last push 2026-10-05, about 22.6k stars.
- **Cost:** free tier 0. Pro is paid, so we avoid it.
- **For Upasthiti:**
  - Number Ticker: live headcount and present/absent counters.
  - Animated List: live punch feed on the dashboard.
  - Animated Circular Progress Bar: attendance %, and the "hold still" capture ring at the kiosk.
  - Border Beam / Shine Border: animated frame around the camera view while scanning.
  - Blur Fade: page and section entrance on the dashboard.
  - Ripple / Pulsating Button: "scanning..." idle pulse.
  - Marquee: notice ticker on the kiosk idle screen.
  - Dot/Grid Pattern: subtle backgrounds.
  - Theme Toggler.
  - Avoid on the kiosk: Globe, Particles, Warp Background, Meteors (CPU/GPU heavy).

### 1.3 Aceternity UI (free vs Pro/templates)
- **What:** flashy copy-paste React/Tailwind/Motion components (spotlight, beams,
  3D cards, sidebar, floating dock, animated tabs, stateful button, file upload).
  Pro/"all-access" adds blocks and templates.
- **Licence:** NOT an open-source licence. The site's single
  [Aceternity License](https://ui.aceternity.com/licence) lets you build unlimited
  end products for yourself or clients. However:
  - You "cannot re-distribute the Item ... or its source files".
  - You cannot sell it, or templates made from it, on any marketplace.
  - The author keeps ownership.
  - Neither the licence page nor the [pricing page](https://ui.aceternity.com/pricing)
    clearly states the licence of the **free** components. There is no public MIT
    repo for them.
- **Pricing:** Free (free components); Annual USD 169/yr; Lifetime USD 199; Team
  USD 1,590 ([pricing](https://ui.aceternity.com/pricing)).
- **Maintenance:** the site is active (new components marked "New"). There is no
  public repo to measure.
- **Risk for us:** our repo will be handed to the client, and it may be public as a
  college project. Copying Aceternity source into it could count as "redistributing
  source files". CLAUDE.md says Aceternity may be used for "free MIT components only",
  and the free components are not shown to be MIT.
- **Verdict:** **inspiration only.** Re-create the effect ourselves with Motion, or
  use the MIT equivalent from Magic UI or Motion Primitives (for example Spotlight,
  Border Trail, Dock, animated tabs). Copy code only after Aceternity confirms in
  writing (support@aceternity.com), and record that in docs/decisions/.
- **URL:** https://ui.aceternity.com

### 1.4 21st.dev
- **What:** a community marketplace/registry of shadcn-compatible components, themes
  and templates. Installs through the shadcn CLI. Also offers AI and MCP tools.
- **Pricing** ([pricing](https://21st.dev/pricing.md)):
  - Free "Hobby" plan: browsing, plus **2 free copies per day**.
  - Builder: USD 6/mo yearly (unlimited installs). Templates are sold per item by
    their authors. The AI add-on is paid.
  - **Use only the free plan.**
- **Licence:** varies **per component**. The platform code is MIT, but each component
  page has a "License" field. Some show `mit`; others show `unknown`
  ([example of unknown](https://21st.dev/@ephraimduncan/components/registration.md)).
- **How to check a component before copying:**
  1. Open the component page and read the **License** field. Accept only MIT, Apache-2.0,
     BSD or ISC. `unknown` or empty means no licence was declared: do NOT use it.
  2. Open the author's profile or linked GitHub repo and confirm the LICENSE file
     matches.
  3. Check whether it is a re-upload of another library (many are Aceternity or
     React Bits clones). If so, the ORIGINAL licence applies (for example Aceternity
     terms or Commons Clause), whatever the 21st.dev field says.
  4. Read the registry JSON dependencies. Every npm dependency it pulls in must also
     be permissive and free.
  5. Log it in the licence log.
- **For Upasthiti:** a quick search for specific patterns (stat cards, empty states,
  file dropzones, OTP-style inputs, status badges).
- **URL:** https://21st.dev

### 1.5 Motion Primitives
- **What:** about 30 open-source motion components for React + Tailwind + Motion
  ([docs](https://motion-primitives.com/docs)).
- **Licence:** MIT ([repo](https://github.com/ibelick/motion-primitives)). There is an
  "Advanced" link to a separate pro site; ignore it.
- **Maintenance:** active. Last push 2026-09-28, about 6.5k stars.
- **Cost:** 0.
- **For Upasthiti:**
  - Sliding Number: big live clock on the kiosk, using SERVER time.
  - Animated Number: dashboard KPIs.
  - Text Loop / Text Effect: rotating greeting "Welcome / स्वागत / सुस्वागतम".
  - Transition Panel: kiosk step changes (scan -> verifying -> result).
  - Border Trail / Glow Effect: camera frame.
  - Morphing Dialog: employee quick view.
  - In View: dashboard reveal.
  - Spotlight: login hero.

### 1.6 Origin UI / coss ui
- **What:** Origin UI was a Radix-based shadcn-style collection. It is now **coss
  ui** (coss.com/ui), Cal.com's official design system, built on **Base UI** +
  Tailwind. Origin UI is kept as a legacy snapshot with "limited support and
  maintenance".
- **Licence:** mixed. The repo default is **AGPL-3.0**; only `apps/ui/` (coss ui) and
  `apps/origin/` (legacy Origin UI) are **MIT**
  ([repo](https://github.com/cosscom/coss), see LICENSING.md). Copy only from the
  MIT folders or from the coss.com/ui docs.
- **Maintenance:** very active. Last push 2026-10-11, about 10.7k stars.
- **Cost:** 0.
- **For Upasthiti:** a good source of well-built form inputs (date range, number
  steppers, tags input, file upload) and table patterns. If we pick Option A (Radix),
  copy from the legacy Origin UI set, which shares the same primitives. Avoid mixing
  Base UI and Radix primitives in one component tree.
- **URL:** https://coss.com/ui

### 1.7 Kibo UI
- **What:** 41 composable shadcn add-on components ([site](https://www.kibo-ui.com)),
  described as "Free and open source, forever".
- **Licence:** MIT ([repo](https://github.com/haydenbleasel/kibo)). There is no paid tier.
- **Maintenance:** moderate. Last push 2026-05-04 (about 5 months ago), about 4k
  stars, not archived. Copy the code in rather than depending on it.
- **Cost:** 0.
- **For Upasthiti:**
  - **QR Code** (render and preview QR ID cards; the signed payload is still made on the server).
  - **Status** (kiosk online/offline dot).
  - **Relative Time** ("last punch 2 min ago").
  - **Contribution Graph** (GitHub-style per-employee attendance heatmap).
  - **Dropzone** (Excel employee import).
  - **Gantt** (shift roster view, an optional extra).
  - **Calendar / Mini Calendar**, **Ticker**, **Banner / Announcement**,
    **Avatar Stack** (who is on shift), **Table**, **Combobox**, **Tags**.

### 1.8 Tremor (dashboard charts)
- **What:** React + Tailwind dashboard and chart components (Recharts underneath).
  Now in a copy-paste version ("Tremor Raw").
- **Licence:** Apache-2.0
  ([tremorlabs/tremor](https://github.com/tremorlabs/tremor),
  [tremor-npm](https://github.com/tremorlabs/tremor-npm)). The site advertises
  "Premium Blocks" (check before use; we would not pay).
- **Maintenance:** **stagnant.** Tremor "is joining Vercel" ([tremor.so](https://tremor.so)).
  - The last real commit to `tremor` was the Tailwind v4 update on 2025-04-12; the
    2025-10-10 commits only removed CI files.
  - `tremor-npm` was last pushed 2025-01-13.
- **Verdict:** do not start a 2026 project on it. Use **shadcn charts (Recharts)**,
  which give the same look and are actively maintained.

### 1.9 React Bits
- **What:** a very popular (about 49k stars) set of animated text, background and
  micro-interaction components ([reactbits.dev](https://reactbits.dev)).
- **Licence:** **"MIT + Commons Clause"**. GitHub reports it as NOASSERTION. The
  [LICENSE.md](https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md)
  (2026):
  - allows use inside an application, website or product, including commercial;
  - forbids selling, sublicensing or redistributing the components themselves.
  - This is **not an OSI open-source licence** and not on our allowed list
    (MIT/Apache/BSD/OFL/ISC).
- **Paid tier:** React Bits Pro is USD 99 / 199 / 299 one-time
  ([pro.reactbits.dev](https://pro.reactbits.dev/about)). Avoid it.
- **Maintenance:** very active (last push 2026-10-10).
- **Verdict:** **ask the team before use.** Using it in the client's app is allowed by
  the Commons Clause wording, but it breaks the "OSI permissive only" rule. Most of its
  backgrounds are WebGL-heavy and unsuitable for kiosk tablets. Prefer Magic UI or
  Motion Primitives equivalents.

### 1.10 uiverse.io
- **What:** a community library of small UI elements (buttons, loaders, toggles,
  checkboxes, cards) in plain CSS or Tailwind. It is HTML/CSS, not React.
- **Licence:** the site footer and the
  [Galaxy repo](https://github.com/uiverse-io/galaxy) say all elements are **MIT**.
  Attribution is "not mandatory" according to the README, but MIT asks you to keep the
  copyright notice, so add a source-URL comment.
- **Maintenance:** the site is live. The Galaxy export repo was last pushed 2024-09-02,
  so the archive is stale while the site keeps growing. The site blocked automated
  fetch (403), so I could not check its date directly.
- **Cost:** 0.
- **For Upasthiti:** ideas for loaders ("Verifying..."), toggle switches and pressed
  button effects. Re-write them as Tailwind classes in our components. Quality varies,
  so check contrast and focus states.
- **URL:** https://uiverse.io

### 1.11 Motion (formerly Framer Motion)
- **What:** the standard React animation library: layout animations, gestures,
  `AnimatePresence`, springs, scroll animations.
- **Licence:** **MIT** for the core library
  ([motiondivision/motion](https://github.com/motiondivision/motion)).
  - **Motion+** is a separate **paid** product: USD 399 one-time for Solo, or a team
    subscription ([motion.dev/plus](https://motion.dev/plus)).
  - Motion+ includes AnimateNumber, Ticker, Typewriter, Carousel, Cursor, ScrambleText,
    splitText and more. **Do not buy or use Motion+.** Use the free MIT alternatives:
    Magic UI Number Ticker and Motion Primitives Sliding/Animated Number.
- **Maintenance:** very active. v14.1.0 on 2026-10-09 and v14.0.0 on 2026-10-02
  (CHANGELOG). About 34k stars.
- **Cost:** 0 for the core.
- **For Upasthiti:** the single animation engine for the whole app: kiosk result
  transitions, dashboard micro-interactions, list re-ordering, reduced-motion support
  (`useReducedMotion`).
- **URL:** https://motion.dev

### 1.12 GSAP (GreenSock)
- **What:** a powerful timeline animation library, now owned by Webflow. All plugins
  (SplitText, MorphSVG, ScrollTrigger and more) are now free.
- **Licence:** **Standard "No Charge" License**, effective 2025-04-30, last modified
  2025-05-30 ([gsap.com/licensing](https://gsap.com/licensing/)). The npm `license`
  field points to gsap.com/standard-license. It is **NOT OSI open source.** Key terms:
  - Commercial use is allowed, plugins included.
  - **Prohibited:** use in visual no-code animation tools that compete with Webflow's
    animation builder, without written consent.
  - No removing branding or notices. No reverse engineering for competitive products.
  - **Webflow can change the licence**; continuing to use newer versions means
    accepting the change.
  - **Webflow can terminate** access for non-compliance.
- **Maintenance:** active. v3.15.0 on 2026-04-13. About 29k stars.
- **Cost:** 0.
- **Assessment:** Upasthiti does not compete with Webflow, so using GSAP would
  technically be allowed today. However:
  1. It breaks CLAUDE.md's "free and open-source only" rule.
  2. It is a vendor-controlled, revocable licence on a product we hand over and cannot
     maintain.
  3. Motion already covers everything we need.
- **Verdict:** **REJECT** (risky, not needed).

### 1.13 Lottie / LottieFiles
- **Players:**
  - **dotlottie-web** (Rust + WASM player with a React wrapper): **MIT**, last push
    2026-10-07 ([repo](https://github.com/LottieFiles/dotlottie-web)). Recommended player.
  - **lottie-web** (Airbnb): MIT, last push 2025-09-01, so slower maintenance
    ([repo](https://github.com/airbnb/lottie-web)).
- **Free animations on lottiefiles.com:** the **Lottie Simple License**
  (FL 9.13.21, Design Barn Inc.)
  ([licence](https://lottiefiles.com/page/license),
  [help](https://help.lottiefiles.com/animation-licensing-basics-)):
  - Commercial use is allowed; attribution is not required (but encouraged).
  - Modifications are allowed. Any distribution must keep the same licence terms.
  - No redistributing the files standalone or reselling them; no scraping to build a
    competing service.
  - Individual animations can carry extra creator restrictions, so check each page.
  - It is not an OSI licence, but it is a permissive asset licence. Treat it like
    Google Fonts' OFL: fine for bundled assets.
- **LottieFiles platform:** has paid plans for hosting and editing. We need none of them;
  download the JSON or .lottie file and self-host it.
- **For Upasthiti:** at most 2-4 tiny assets: success tick, failure cross, "look at
  the camera" hint, "show your card" hint. Record each file's source URL in the
  licence log. An equally good zero-risk alternative is to draw them as SVG + Motion.

### 1.14 Rive
- **What:** an interactive, state-machine-driven animation editor plus runtimes.
- **Runtime licence:** **MIT** ([rive-wasm](https://github.com/rive-app/rive-wasm),
  last push 2026-10-11).
- **Editor cost:** the free plan has 3 collaborative files and 1 project. The live
  pricing page says **"Free exports play a Rive splash screen"**, and the paid Cadet
  plan is needed to remove it ([pricing](https://rive.app/pricing)). Rive's Oct 2025
  post moved new exports to paid plans, with Cadet at USD 9/mo
  ([blog](https://rive.app/blog/rive-s-new-9-mo-plan)).
- **Verdict:** **REJECT.** A splash screen on a gate kiosk is unacceptable, and
  removing it costs money.

### 1.15 Icons
| Set | Licence | Activity | Count / styles | Use in Upasthiti |
|---|---|---|---|---|
| **Lucide** ([lucide.dev](https://lucide.dev), [repo](https://github.com/lucide-icons/lucide)) | **ISC**, plus MIT for the Feather-derived icons (both in the LICENSE file) | Last push 2026-10-10, about 25k stars | 1,500+ consistent stroke icons, tree-shakable React package | **Default set.** It is shadcn's default, so it is consistent everywhere in the admin UI. |
| **Tabler Icons** ([tabler.io/icons](https://tabler.io/icons), [repo](https://github.com/tabler/tabler-icons)) | MIT | Last push 2026-10-10, about 22k stars | 6,200+ icons, outline + **filled** | Backup when Lucide lacks an icon (factory, helmet, fingerprint, id-badge, qrcode, scan-eye). Filled versions read better as large kiosk pictograms. |
| **Phosphor** ([phosphoricons.com](https://phosphoricons.com), [repo](https://github.com/phosphor-icons/react)) | MIT | Last push 2026-01-06 (slower) | 6 weights incl. Fill and Duotone | OK alternative for kiosk pictograms, but don't use three sets. Pick Lucide + Tabler. |

### 1.16 Charts
| Library | Licence | Activity | Use |
|---|---|---|---|
| **Recharts** ([recharts.org](https://recharts.org), [repo](https://github.com/recharts/recharts)) | MIT | Stable v3.10.1 on 2026-07-25; v3.11.0 canaries through 2026-10-03 | **Recommended**, through [shadcn charts](https://ui.shadcn.com/charts) (built on Recharts). Headcount by hour, late arrivals by day, plant comparison, overtime trend. |
| **Apache ECharts** ([echarts.apache.org](https://echarts.apache.org), [repo](https://github.com/apache/echarts)) | Apache-2.0 | v6.1.0 on 2026-05-19 | Optional. Best if we need a **calendar heatmap** of monthly attendance, very large datasets, or canvas rendering for big tables. Heavier bundle, and its own styling system (does not match shadcn theming). |
| **visx** ([airbnb.io/visx](https://airbnb.io/visx), [repo](https://github.com/airbnb/visx)) | MIT | Last push 2026-06-22 | Low-level D3 + React primitives. Powerful but needs much more code, so it is a poor fit for student maintainability. Avoid. |

---

## 2. Design inspiration tools (beyond Godly, Dribbble, Awwwards, Mobbin, Figma Community, 21st.dev, Aceternity, Magic UI)

Use for **ideas only**. Screenshots of other products are copyrighted, so never copy
artwork directly. Save chosen references in docs/design-refs/ with source links.

| Tool | URL | Cost | Good for here |
|---|---|---|---|
| Refero | https://refero.design | Freemium: limited free access; Pro roughly GBP/USD 10-14/mo (third-party figures conflict) | Real SaaS screens: tables, filters, settings, empty states, onboarding. Free tier is enough for a quick search. |
| Land-book | https://land-book.com | Freemium (free: limited categories, 3 boards; Pro about USD 6-9/mo per Toolradar) | Mostly marketing landing pages. Low relevance, only for the login/marketing page. |
| Page Flows | https://pageflows.com | **Paid** (about USD 39/quarter; the trial may itself be paid) | Recorded user flows. **Skip** (not free). |
| UI Sources | https://www.uisources.com | Now **redirects to screensdesign.com** (iOS paywall/onboarding library, paid "Pro") | **Skip.** Mobile-app focus, not relevant. |
| SaaS Frame | https://www.saasframe.io | Freemium: only about 3 of 166 dashboards free; Pro USD 10-14/mo | Dashboard and settings screens. Free sample only. |
| Collect UI | https://collectui.com | Free | Daily UI shots by category (login, dashboard). Activity unclear, so low priority. |
| Screenlane | https://screenlane.com | Paid; reportedly not updated since about 2023 | **Skip.** |
| Uiverse | https://uiverse.io | Free (MIT) | Micro-interaction ideas: loaders, toggles, pressed states. |
| Muzli | https://muz.li | Free browser extension; active (2026) | Daily inspiration feed, palette generator. |
| Behance | https://www.behance.net | Free | Full **case studies**. Search "attendance kiosk", "HRMS dashboard", "face recognition UI", "factory dashboard". Good for process and rationale. |
| Untitled UI free Figma kit | https://www.untitledui.com/free-figma-ui-kit | Free; commercial use allowed (single user) | A clean reference for spacing, tables, badges, dashboard layouts in Figma. Its React library is MIT ([repo](https://github.com/untitleduico/react)), but we would only use the Figma kit for design. |
| Material 3 | https://m3.material.io (+ official "Material 3 Design Kit" on Figma Community) | Free | Guidance on states, motion, **48dp touch targets**, colour roles. Check the Figma Community file licence (usually CC BY 4.0) on the file page. |
| Fluent 2 | https://fluent2.microsoft.design (+ Fluent 2 Web UI kit on Figma Community) | Free | Dense enterprise data and table patterns for the admin side. |
| GOV.UK Design System | https://design-system.service.gov.uk | Free (govuk-frontend is MIT) | The best reference for **plain-language error messages**, form validation and accessible patterns. Ideal for kiosk rejection messages and HR forms. |
| Coolors | https://coolors.co | Free (optional paid Pro, not needed) | Palette generation and a contrast checker. |
| Realtime Colors | https://www.realtimecolors.com | 100% free | Preview a palette on a real layout, AA/AAA contrast lights, **export to Tailwind/CSS in OKLCH** (matches shadcn's OKLCH theme tokens). |
| Fontjoy | https://fontjoy.com | Free | Latin-only pairing generator (Google Fonts). **Not useful for Devanagari**; use only for the Latin side. |
| Google Fonts | https://fonts.google.com (filter Writing system = Devanagari) | Free (OFL) | Font choice. Self-host through **Fontsource** (https://fontsource.org) so the kiosk works offline and makes no third-party calls. |
| WebAIM Contrast Checker | https://webaim.org/resources/contrastchecker/ | Free | Quick AA/AAA checks for the 7:1 kiosk target. |
| Mobbin (already listed) | https://mobbin.com | Free plan is limited (no flows/search, 3 collections); Pro about USD 15/mo | Stay on the free plan. |

---

## 3. Fonts (Latin + Devanagari, all free on Google Fonts, all SIL OFL 1.1)

Verified from `google/fonts` METADATA.pb files and Fontsource:

| Font | Designer | Scripts | Axes / weights | Notes |
|---|---|---|---|---|
| **Anek Devanagari** | Ek Type (Mumbai) | devanagari, latin, latin-ext | **Variable wght 100-800 + wdth 75-125** | Modern, open, built for UI. The width axis fits long Marathi/Hindi labels into fixed kiosk buttons without shrinking size. https://fonts.google.com/specimen/Anek+Devanagari |
| **Noto Sans Devanagari** | Google | devanagari, latin, latin-ext | **Variable wght 100-900 + wdth 62.5-100** | Lists **mr_Deva (Marathi)** and hi_Deva explicitly. Most complete coverage; neutral look. https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari |
| **Mukta** | Ek Type | devanagari, latin, latin-ext | Static 200-800 (7 weights) | Very readable, open counters, good for low-literacy body text. Static fonts mean more files. https://fonts.google.com/specimen/Mukta |
| **Baloo 2** | Ek Type | devanagari, latin, latin-ext, vietnamese | Variable wght 400-800 | Rounded and friendly: great for **huge kiosk numerals and headings**, too playful for dense admin tables. https://fonts.google.com/specimen/Baloo+2 |
| **Hind** | Indian Type Foundry | devanagari, latin | Static 300-700 (5 weights) | Classic, but older and less flexible than Anek or Noto. |
| **Tiro Devanagari Marathi** | Tiro Typeworks (John Hudson, Fiona Ross, Paul Hanslow) | devanagari, latin | Regular + Italic only | A **Marathi-specific serif**. Not for UI; nice for printed QR ID cards, report headers and certificates. https://fonts.google.com/specimen/Tiro+Devanagari+Marathi |
| **Inter** | Rasmus Andersson | latin, cyrillic, greek, vietnamese | Variable wght 100-900 + **opsz 14-32** | Tabular figures (aligned times and hours in tables); the shadcn-style default look. |
| **Geist** | Vercel | latin, cyrillic, vietnamese | Variable wght 100-900 | Modern alternative to Inter. No Devanagari. |
| Plus Jakarta Sans | Tokotype | latin | Variable | Friendly geometric Latin; works for headings. |

### Recommended pairing 1 (primary): **Anek Devanagari + Inter**
- Licence: both OFL 1.1, so free for commercial use, embedding and self-hosting.
- Why:
  - Two variable files cover every weight.
  - Anek's width axis solves the "Marathi label too long for the button" problem.
  - Ek Type (Mumbai) designs with Marathi and Hindi users in mind.
  - Inter's tabular numerals keep punch times, hours and headcounts aligned in reports.
  - Both look modern ("premium").
- Use Inter for Latin UI and numbers, and Anek for Devanagari through a CSS
  `font-family` stack (`Inter, "Anek Devanagari", sans-serif`). The browser
  falls back to Anek for Devanagari characters automatically.

### Recommended pairing 2 (maximum safety): **Noto Sans Devanagari + Noto Sans (or Inter)**
- Licence: OFL 1.1.
- Why: Google designed the Noto family to harmonise across scripts (matched heights
  and weights), and the metadata explicitly lists Marathi. It is the lowest-risk choice
  for correct conjuncts. It looks plainer, so the "premium" feel has to come from
  layout and motion.

**Optional display accent:** Baloo 2 only for the giant kiosk clock and the result
name or number.

### Font implementation guidance
- Set `lang="mr"`, `lang="hi"` or `lang="en"` on the root (WCAG 3.1.1) and on mixed
  fragments (3.1.2). Fonts that carry Marathi `locl` forms only switch glyphs when the
  language is tagged.
- **Test Marathi-specific shapes** (ल, श, and eyelash र as in र्‍य) in Chrome on
  the actual kiosk tablet before final selection. I could not confirm `locl` Marathi
  support for Anek or Noto from public docs.
- Devanagari needs more line height (about 1.5-1.6) so top matras and lower vowel
  signs are not clipped. Set it about 10-15% larger than Latin at the same visual
  weight.
- Self-host through Fontsource npm packages, subset to latin + devanagari, and
  preload. The kiosk then needs no external font CDN, works offline and makes no
  third-party request.

---

## 4. Public-kiosk accessibility guidance (with sources)

Upasthiti's kiosk users are shop-floor workers, some with low literacy, possibly
wearing gloves, at a gate in daylight, speaking Marathi, Hindi or English. Targets
below are **our recommendations**, built on the cited minimums.

### 4.1 Touch targets
- WCAG 2.2 **SC 2.5.8 Target Size (Minimum), AA:** at least **24x24 CSS px** (with
  spacing exceptions). https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG **SC 2.5.5 Target Size (Enhanced), AAA:** **44x44 CSS px**.
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- Platform norms: Apple HIG **44x44 pt**; Material **48x48 dp**
  (https://m3.material.io/foundations/designing/structure). ISO 9241-9 is cited
  secondhand as about **22 mm** for physical buttons.
- **Upasthiti kiosk rule:**
  - Primary buttons at least **72 CSS px** high (about 15-20 mm on a 10" tablet).
  - Secondary buttons (language switch, help) at least **56 px**.
  - At least **16 px** between targets (gloves, dust, hurried users).
  - The punch flow itself should need **zero taps**: face or QR detection starts
    automatically.
- Reach and mounting: ADA reach range for operable parts is **15-48 in (about
  38-122 cm)** above the floor
  ([Access Board guide](https://www.access-board.gov/files/ada/guides/operable-parts.pdf)).
  Mount the screen inside this band, with the camera angled to capture faces from
  both short and tall workers (and wheelchair users).

### 4.2 Text size
- ADA 2010 **707.7.2** (ATMs and fare machines): screen characters must be
  **sans-serif** and at least **4.8 mm (3/16 in)** tall, measured on uppercase "I"
  ([reproduction](https://www.corada.com/documents/2010ADAStandards/707-7)). Section
  508 has the same rule for closed-functionality ICT
  ([section508.gov](https://www.section508.gov/develop/fonts-typography)).
- GOV.UK uses **19px** body text even on small screens, "tested and iterated for
  readability" ([type scale](https://design-system.service.gov.uk/styles/type-scale/)).
- **Upasthiti kiosk rule** (viewing distance about 50-80 cm):
  - body/instructions at least **28 px**;
  - result name and status at least **48 px**;
  - clock and IN/OUT at least **72 px**;
  - never below 24 px anywhere on the kiosk.
  - Admin dashboard body: 14-16 px.

### 4.3 Contrast and daylight readability
- WCAG **1.4.3** AA 4.5:1; **1.4.6** AAA **7:1**; **1.4.11** non-text contrast 3:1;
  **1.4.1** never use colour alone. https://www.w3.org/TR/WCAG22/
- **Upasthiti kiosk rule:**
  - Aim for **7:1** on every kiosk text.
  - Default to a **light, high-contrast theme** (dark text on near-white), which holds
    up better under glare than dark UIs.
  - Success and fail states use **colour + icon + word + sound**, never colour alone.
- Hardware (for the client's purchase advice):
  - Typical tablets have 400-600 nits. AVIXA suggests **700-1,500 nits** for
    shaded/semi-outdoor and **1,500-2,500+ nits** for direct sun.
    ([AVIXA](https://xchange.avixa.org/posts/how-to-choose-the-right-brightness-for-indoor-and-outdoor-commercial-displays))
  - Anti-glare treatment and optical bonding matter as much as brightness.
  - The cheapest fix is a **canopy or hood** over the kiosk, facing away from the sun.
    This also helps face recognition (no backlit faces).

### 4.4 Audio and haptic feedback
- EN 301 549 **5.1 (closed functionality)**: kiosks must give **speech output** that
  is interruptible and repeatable, built-in or through a headset
  ([summary](https://accessible.canada.ca/node/380)). ADA **707.5** requires speech
  output on ATMs and fare machines, with volume control and repeat.
- WCAG **1.4.2** Audio Control: any auto-playing audio longer than 3 s needs a
  stop or volume control.
- **Upasthiti kiosk rule:**
  - A distinct short **success tone** and **failure tone**.
  - Optional **spoken confirmation** in the worker's language ("Ramesh, check-in
    recorded, 8:57").
  - Admin-set volume per kiosk.
  - Haptics are unreliable (most gate tablets are fixed, and many browsers don't
    support vibration), so treat them as a bonus only.

### 4.5 Low-literacy design
- NN/g, *Lower-Literacy Users*: they read word by word. Use minimal text, one main
  column, linear flow, and about a 6th-grade reading level
  (https://www.nngroup.com/articles/writing-for-lower-literacy-users/).
- W3C COGA, *Making Content Usable for People with Cognitive and Learning
  Disabilities* (W3C Note, 2021) (https://www.w3.org/TR/coga-usable/):
  - clear purpose per screen (4.2.1);
  - familiar icons (4.2.7) and **symbols placed with text** (3.1.3);
  - consistent design (4.2.3);
  - avoid timeouts and data loss (4.5.9);
  - clear steps (4.2.4);
  - easy human help (4.8.1).
- **ISO 7001:2023** public information symbols (https://www.iso.org/standard/77442.html):
  use recognised pictograms, paired with text.
- **Upasthiti kiosk rule:**
  - Each screen has one idea and one big pictogram.
  - The result shows the **employee's own photo or name**, IN/OUT and the time. People
    recognise their face faster than reading.
  - Rejection reasons are simple pictograms with text: "Come closer", "Card expired:
    see HR", "Already punched: wait 2 min".
  - Never show technical errors to workers.

### 4.6 Multilingual switching
- Show language buttons **in their own script**: "मराठी", "हिन्दी", "English".
  Never use flags.
- Default language is a **per-plant (or per-kiosk) setting**. After a face or QR
  match, switch to the **employee's preferred language** for that result, then return
  to the default.
- Tag the language in markup (WCAG 3.1.1 / 3.1.2).
- India context:
  - **GIGW 3.0** (Guidelines for Indian Government Websites) targets **WCAG 2.1 AA**
    (https://guidelines.india.gov.in).
  - **IS 17802** (BIS) is India's ICT accessibility standard, aligned with EN 301 549.
    Secondary sources say it was made binding under the RPwD Rules in 2023
    ([overview](https://www.digitala11y.com/?p=36535)). It is good practice to design
    toward it even for a private client.

### 4.7 Timing and motion
- WCAG **2.2.1** Timing Adjustable: the result screen auto-returns after about
  4-5 s, but "tap to keep" or a help screen must not time out abruptly.
- WCAG **2.3.1** Three Flashes: no flashing "scan" effects.
- WCAG **2.3.3** Animation from Interactions: honour `prefers-reduced-motion`, and
  offer an admin toggle "Reduce kiosk animation".
- Burn-in: an always-on screen needs an idle "attract mode" with gentle pixel shift
  (see extras).

---

## 5. Proposed extras (UI)

| # | Extra | Why it helps | Effort | Risk |
|---|---|---|---|---|
| 1 | **Voice + tone prompts in the worker's language.** Short pre-recorded clips (Marathi/Hindi/English) for "Look at the camera", "Show your card", "Check-in done", "Try again". Optional Web Speech API to say the name and time. Admin volume per kiosk. | Low-literacy and multilingual users get instant confirmation without reading. Also meets the kiosk speech-output idea from EN 301 549 and ADA 707. | M | Low-Med. Browser TTS voices for Marathi vary by device, so test and fall back to recorded clips. A noisy gate needs a loud enough speaker. Clips recorded by the client's own staff avoid licence questions. |
| 2 | **Emergency muster screen.** One tap on the dashboard (and a hidden admin gesture on the kiosk) shows "Who is inside now" per plant: last IN without OUT. Includes contractors and temps, with photos and a printable or offline list. | Real safety value for a manufacturing plant (fire or evacuation roll-call). A strong demo feature for the client. | M | Medium. Accuracy depends on workers punching OUT, so label it "Based on punches as of HH:MM". Must work from cached data if the internet is down. |
| 3 | **Kiosk health tile and status wall.** Per kiosk: heartbeat, last sync, queued offline punches, camera OK, GPS accuracy, battery, app version. Alerts when offline longer than N minutes. Uses the Kibo UI Status + Relative Time components. | Gate devices fail silently. HR sees problems before workers complain, and it supports the offline-sync milestone (M4). | M | Low. Needs a small heartbeat endpoint, so it is a light API addition. |
| 4 | **Multimodal result screen with safe rejection pictograms.** Full-screen green or red, employee photo (or QR snapshot thumbnail), name, IN/OUT, server time, icon + word + tone. Rejections show simple worker-safe reasons; detailed anti-proxy reasons go only to the admin audit log. | The fastest possible confirmation, which reduces queues at shift change. It also avoids teaching cheaters which rule caught them. | S | Low. The main care point is keeping rejection detail generic on screen. |
| 5 | **Idle "attract mode" + daylight theme.** When idle: big live server clock (Motion Primitives Sliding Number), rotating trilingual greeting, current shift name, plant notices (Magic UI Marquee), gentle pixel shift against burn-in. Auto high-contrast theme by time of day or admin setting. | Looks premium, tells workers the kiosk is alive, protects the screen, and improves daylight readability. | S | Low. Keep animation CPU-light on cheap tablets and respect reduced motion. |
| 6 | **Live punch feed + attendance heatmap on the dashboard.** Magic UI Animated List for the real-time punch stream (with exception badges: late, rejected, offline-synced). Per-employee and per-plant monthly heatmap (Kibo Contribution Graph, or the ECharts calendar if needed). | Supervisors spot patterns (chronic lateness, a kiosk producing rejections) at a glance. Makes the dashboard feel alive. | S-M | Low. Needs realtime updates (SSE or polling) and an efficient aggregate query. |

---

## 6. Sources (all URLs used)

**Components and libraries**
- https://github.com/shadcn-ui/ui
- https://github.com/shadcn-ui/ui/releases
- https://ui.shadcn.com/charts
- https://github.com/magicuidesign/magicui
- https://magicui.design/docs/components
- https://pro.magicui.design/license
- https://pro.magicui.design/pricing
- https://ui.aceternity.com/licence
- https://ui.aceternity.com/pricing
- https://ui.aceternity.com/components
- https://21st.dev
- https://21st.dev/pricing.md
- https://21st.dev/@ephraimduncan/components/registration.md
- https://github.com/ibelick/motion-primitives
- https://motion-primitives.com/docs
- https://github.com/cosscom/coss
- https://github.com/origin-space/originui
- https://github.com/haydenbleasel/kibo
- https://www.kibo-ui.com
- https://tremor.so
- https://github.com/tremorlabs/tremor
- https://github.com/tremorlabs/tremor-npm
- https://reactbits.dev
- https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md
- https://pro.reactbits.dev/about
- https://uiverse.io
- https://github.com/uiverse-io/galaxy
- https://github.com/motiondivision/motion
- https://motion.dev/plus
- https://gsap.com/licensing/
- https://github.com/greensock/GSAP
- https://github.com/LottieFiles/dotlottie-web
- https://github.com/airbnb/lottie-web
- https://lottiefiles.com/page/license
- https://help.lottiefiles.com/animation-licensing-basics-
- https://rive.app/pricing
- https://rive.app/blog/rive-s-new-9-mo-plan
- https://github.com/rive-app/rive-wasm

**Icons and charts**
- https://github.com/lucide-icons/lucide
- https://github.com/tabler/tabler-icons
- https://github.com/phosphor-icons/react
- https://github.com/recharts/recharts
- https://github.com/apache/echarts
- https://github.com/airbnb/visx

**Design inspiration tools**
- https://www.untitledui.com/free-figma-ui-kit
- https://github.com/untitleduico/react
- https://www.realtimecolors.com
- https://fontjoy.com
- https://muz.li
- https://collectui.com
- https://screensdesign.com
- https://toolradar.com/tools/land-book/pricing
- https://toolradar.com/tools/pageflows/pricing
- https://www.saasframe.io/categories/dashboard
- https://mobbin.com/pricing.md
- https://www.lazyweb.com/compare/mobbin-vs-refero.md

**Fonts**
- https://raw.githubusercontent.com/google/fonts/main/ofl/anekdevanagari/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/mukta/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/tirodevanagarimarathi/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/inter/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/geist/METADATA.pb
- https://fontsource.org

**Accessibility**
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- https://www.w3.org/TR/coga-usable/
- https://design-system.service.gov.uk/styles/type-scale/
- https://www.access-board.gov/files/ada/guides/operable-parts.pdf
- https://www.corada.com/documents/2010ADAStandards/707-7
- https://www.section508.gov/develop/fonts-typography
- https://www.access-board.gov/sstm/
- https://accessible.canada.ca/node/380
- https://www.iso.org/standard/77442.html
- https://xchange.avixa.org/posts/how-to-choose-the-right-brightness-for-indoor-and-outdoor-commercial-displays
- https://guidelines.india.gov.in
- https://www.digitala11y.com/?p=36535
- https://www.nngroup.com/articles/writing-for-lower-literacy-users/

## 7. Open questions for the team
1. Aceternity: copy code at all? Recommendation: no, unless Aceternity confirms in
   writing that the free components can sit in a handed-over (possibly public) repo.
2. React Bits ("MIT + Commons Clause"): allow as an exception, or stay strictly OSI?
   Recommendation: stay strictly OSI.
3. Will the client mount the kiosks under a canopy? If not, budget for a sunlight-readable
   display (hardware cost to the client, not to the software).
4. Kiosk default language per plant: Marathi or Hindi?
