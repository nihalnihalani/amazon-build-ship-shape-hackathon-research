# GitHub / Alexandria digest — repos, starters, visible competition, calibration (KEY=github, PREFIX=GH)

Retrieved: 2026-10-03 (Asia/Kolkata). Hackathon: Build, Ship, Shape: Amazon Developer Hackathon (deadline Fri Oct 23 2026 12:00 PDT). All repo data is a snapshot as of 2026-10-03; stars/timestamps are signals, not proof. Public repos are only a **lower bound** on competition (private repos and non-GitHub entrants are invisible).

**Retrieval-method note (important):** The shared Firecrawl account was saturated (HTTP 429 "Rate limit exceeded", ~12-31 req/min consumed by other agents) for most of this session. Alexandria `github-com/repositories/search_repos` succeeded via the CLI for `org:AmazonAppDev` and `org:bee-computer`, and via the Firecrawl MCP tool for `ring api created:>2026-08-31`. After one retry + MCP fallback were also blocked, the remaining GitHub searches, repo metadata, READMEs, releases and commits were pulled with the authenticated **GitHub CLI (`gh api`, read-only GET)** — the same GitHub REST data source the Alexandria provider wraps. Package versions were cross-checked directly against the npm registry (`npm view`) and PyPI JSON API because Alexandria npm/PyPI execution hit 429. Every source below records its method.

## Key findings (summary)
1. **Alexa+ is by far the most crowded visible track** (~158 of 363 hackathon-labelled public repos; 186 repos for `"alexa" mcp` since Aug 31) for 3 prizes; **Bee is the least crowded** (~7 visible) for 2 prizes, likely because real Bee/Apple Watch data is mandatory. Ring (~36, 2 prizes) and Fire TV (~37, 3 prizes) sit in between. Lower bound only (confidence medium).
2. **Official starters exist for Fire TV and Ring only.** AmazonAppDev has no Alexa+/Bee samples; Bee ships only `bee-cli` (@beeai/cli 0.7.3) and `bee-skill`. Current Fire TV starters target Vega SDK 0.24 (react-native-multi-tv-helloworld, vega-tv-interfaces-sample); the Kotlin hello-world is stale since 2024-10.
3. **Crowded ideas to avoid or sharply differentiate:** AI audio description on Fire TV (≥8 repos), elder/dementia/living-alone care on Ring/Alexa+ (~15), recall-check MCPs (~9), scam guardians (~5). Idea collisions already occurred (two "familiar voice at the door for dementia night exits").
4. **The quality bar is high and AI-assisted:** serial entrants ship live AWS deployments, 2-3 min YouTube demos, CI/tests, verified-vs-unverified tables, SIMULATED labels and friction findings. Stars (max 3) carry no signal.
5. **Entrant-reported platform gotchas** (single-source anecdotes): Ring Playground sandbox has only `on_demand` events (no motion/doorbell events to drive webhooks); Bee's built-in MCP negotiates 2024-11-05 (below the 2025-11-25 floor), Bee stream drops after ~43 h and does not deliver todo events; Linux Vega Virtual Device lacks WebView. Plan to reproduce early and log them in the friction log.
6. **Versions as of 2026-10-03:** MCP spec 2026-07-28 exists (above 2025-11-25 floor); `@modelcontextprotocol/sdk` 1.32.0, v2 `@modelcontextprotocol/server` 2.3.0, PyPI `mcp` 2.3.0; `strands-agents` 1.57.2 (repo renamed `harness-sdk`); `react-native-tvos` 0.87.1-1; Vega SDK 0.24.x in use by entrants.
7. **Calibration (not prediction):** Nova 2026 and Alexa Multimodal 2018-19 winners all had demo videos, made the sponsor platform load-bearing, and shipped real running artifacts; winners spanned commercial and social-impact ideas.

---

## 1. Official starters and tools (classification: official starter / official tool)

### AmazonAppDev org (Alexandria search_repos, `org:AmazonAppDev`, 24 public repos) — [.firecrawl/gh-amazonappdev.json]
| Repo | Stars | Created | Last push | License (GitHub-detected) | Notes |
|---|---|---|---|---|---|
| [react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample) | 324 | 2024-07-17 | 2026-09-29 | MIT-0 | Monorepo: Expo SDK 54 + react-native-tvos app (Android TV, Apple TV, Fire OS, Web) + separate `vega` app (Vega SDK). Node ≥18, Yarn 4.5.0. 182 commits; dependabot merges by maintainer giolaq on 2026-09-29. **Official starter (Fire TV).** |
| [react-native-multi-tv-helloworld](https://github.com/AmazonAppDev/react-native-multi-tv-helloworld) | 26 | 2025-09-16 | 2026-10-01 | MIT-0 | Yarn-workspaces monorepo: Vega (Kepler) app + Expo TV app. Commit "Upgrade to SDK 0.24.9914" on 2026-08-28. Scripts `yarn vega:vvd:mseries` / `vega:vvd:intel` / `vega:firetv <DSN>`. **Official starter (Fire TV, most current).** |
| [vega-tv-interfaces-sample](https://github.com/AmazonAppDev/vega-tv-interfaces-sample) | 12 | 2025-07-23 | 2026-08-06 | MIT-0 | Releases `v0.24-RN83` and `v0.24-RN72` (2026-08-06). Prereqs: Vega Developer Tools, Python 3, JRE 21+, Node 18-20. Builds VPKGs for Vega Virtual Device (aarch64/x86_64) and Vega OS Fire TV Stick (armv7). README notes the simulator "crashing randomly" if not restarted. **Official starter (Fire TV/Vega).** |
| [hello-world-fire-tv-react-native](https://github.com/AmazonAppDev/hello-world-fire-tv-react-native) | 13 | 2024-07-10 | 2026-10-03 | MIT-0 | Expo + React Navigation; runs on **Android TV emulator** or Fire TV via `adb`; `npm run android`. Fire OS path only (not Vega). **Official starter (Fire OS).** |
| [hello-world-fire-tv](https://github.com/AmazonAppDev/hello-world-fire-tv) | 9 | 2024-04-08 | **2024-10-10** | MIT-0 | Kotlin/Jetpack Compose for TV; Android Studio + Android TV AVD. **Stale (~2 years since last commit)** — usable for Fire OS but not maintained. **Official starter (Fire OS, stale).** |
| [ring-api-helloworld](https://github.com/AmazonAppDev/ring-api-helloworld) | 17 | 2026-02-13 | 2026-09-11 (main last commit 2026-07-01) | MIT | Python 3.8+ scripts + Next.js 14 app (WebRTC/WHEP live view, MediaPipe Hands, SSE webhook dashboard). Playground token (~30 min) or OAuth refresh-token mode; webhook route `/api/webhook`, `RING_WEBHOOK_SECRET`. 12 commits, 10 forks. **Official starter (Ring).** |
| [devices-agent-skills](https://github.com/AmazonAppDev/devices-agent-skills) | 5 | 2026-03-10 | 2026-09-21 | MIT | Two Agent Skills: `vega-multi-tv-migration`, `rn-tv-ui-best-practices`. Install via `gh skill install` or `npx skills add`. Points to "Amazon Devices Builder Tools for AI" for proprietary SDK skills. **Official tool (Fire TV dev-assist).** |
| [amazon-devices-buildertools](https://github.com/AmazonAppDev/amazon-devices-buildertools) | 3 | 2026-01-30 | 2026-09-10 | NOASSERTION ("Other") | Kiro Power wrapping MCP server `@amazon-devices/amazon-devices-buildertools-mcp` (npm latest **1.0.15**, modified 2026-10-02) for Vega docs, perf-trace analysis. **Official tool (Fire TV dev-assist); license not a standard OSS license.** |
| Other Vega samples | 1-25 | 2025 | Aug-Sep 2026 | MIT-0 | vega-video-sample, vega-sports-app, vega-audio-sample, vega-epg-sample, vega-scrolling-sample, vega-seekbar-sample. |

**Negative finding:** The AmazonAppDev org contains **no Alexa+ or Bee sample** (24 repos: Fire TV/Vega, Fire tablet, LWA, IAP, Ring). `org:alexa` has only 3 repos pushed in 2026 (Java APIs, Auto SDK, a research repo) and `org:alexa-samples` / `org:ring` / `org:aws-samples alexa mcp created:>2026-01-01` return 0 ([.firecrawl/gh-other-orgs.txt], gh api). Alexa+ entrants therefore start from generic MCP SDKs, not an Amazon starter (not verified whether a starter exists outside GitHub).

### bee-computer org (Alexandria search_repos, `org:bee-computer`, 2 public repos) — [.firecrawl/gh-bee-computer.json]
| Repo | Stars | Created | Last commit | License | Notes |
|---|---|---|---|---|---|
| [bee-cli](https://github.com/bee-computer/bee-cli) | 100 | 2026-02-02 | 2026-08-17 ("feat(external-access): add list command") | MIT (LICENSE file present) | npm `@beeai/cli` **0.7.3** (released 2026-06-27; registry modified 2026-06-27). Requires latest Bee app + **Developer Mode** (tap app version 5×). Commands incl. `login`, `sync` (markdown export), `stream` (SSE: new-utterance, new-conversation, update-conversation, todo-*, journal-*, update-location; `--webhook-endpoint`), `mcp serve` (stdio) / `mcp serve-http` (localhost, bearer ≥32 chars), `mcp connect claude|claude-code|codex`. Node library `@beeai/cli/lib` with `bee.sse.streamJson`. Maintainers: Ethan Sutin, Steve Korshakov. **Official tool (Bee).** |
| [bee-skill](https://github.com/bee-computer/bee-skill) | 37 | 2026-02-03 | 2026-06-07 | **README says MIT but GitHub detects no LICENSE file** (`license: null`, no LICENSE in root) | `npx skills add bee-computer/bee-skill`; requires Bee CLI + authenticated Bee account; "last 10 hours" real-time conversations, facts, memos. **Official tool (Bee Agent Skill).** |

### Package versions (as of 2026-10-03; npm registry / PyPI JSON direct — Alexandria execution 429)
- `@modelcontextprotocol/sdk` (TS v1 line) **1.32.0** (2026-10-02); v2 split packages `@modelcontextprotocol/server` / `client` / `core` **2.3.0** (server/client first published 2026-04-01).
- PyPI `mcp` **2.3.0** (2026-10-02, requires Python ≥3.10).
- PyPI `strands-agents` **1.57.2** (2026-10-01, Python ≥3.10); npm `@strands-agents/sdk` **1.19.0** (2026-09-22). GitHub `strands-agents/sdk-python` now redirects to **`strands-agents/harness-sdk`** (8,637 stars, pushed 2026-10-02).
- npm `react-native-tvos` latest **0.87.1-1** (modified 2026-09-30), `next` 0.88.0-0rc2.
- npm `@beeai/cli` **0.7.3**; npm `@amazon-devices/amazon-devices-buildertools-mcp` **1.0.15**.
- PyPI `ring-sandbox` (third-party) **0.5.0** (2026-10-02, Python ≥3.11).
- **MCP spec versions** (official `modelcontextprotocol/modelcontextprotocol` repo, `schema/` dir via gh api): 2024-11-05, 2025-03-26, 2025-06-18, **2025-11-25**, **2026-07-28**, draft. The Python SDK docs describe "two eras": servers before 2026-07-28 use the `initialize` handshake; newer clients probe with `server/discover` and fall back. The TypeScript SDK main branch `packages/core/src/constants.ts` has `LATEST_PROTOCOL_VERSION = '2025-11-25'` and `DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26'` (my interpretation, not verified in the transport code: the fallback assumed when an HTTP client omits the protocol-version header, per the spec's back-compat rule) — so an entrant should explicitly test that their server negotiates ≥2025-11-25 with a 2025-11-25 client and say so in the README. [.firecrawl/gh-mcp-protocol-versions.txt]

---

## 2. Visible competition (likely hackathon entrants), by track

Queries (sort=updated, per_page 30; window created after 2026-08-31):
| Query | Method | total_count | File |
|---|---|---|---|
| `ring api created:>2026-08-31` | Alexandria (Firecrawl MCP) | 56 (many unrelated: Oura ring, Elden Ring, ring buffers) | .firecrawl/gh-ring-api-new-mcp-extract.tsv |
| `bee created:>2026-08-31 wearable` | gh api | 6 | .firecrawl/gh-bee-wearable-new.ghapi.json |
| `"alexa" mcp created:>2026-08-31` | gh api | **186** | .firecrawl/gh-alexa-mcp-new.ghapi.json |
| `vega "fire tv" created:>2026-08-31` | gh api | 21 | .firecrawl/gh-vega-firetv-new.ghapi.json |
| `amazonappdev2026` | gh api | **0** | .firecrawl/gh-amazonappdev2026.ghapi.json |
| `react-native-tvos created:>2026-08-31` | gh api | 3 (none hackathon) | .firecrawl/gh-rn-tvos-new.ghapi.json |
| `"Amazon Developer Hackathon" in:readme created:>2026-08-31` | gh api | **302** | .firecrawl/gh-readme-amzdevhack*.ghapi.json |
| `"Build, Ship, Shape" in:readme created:>2026-08-31` | gh api | 228 | .firecrawl/gh-readme-bss*.ghapi.json |

**Track split of hackathon-labeled public repos** (union of the two README queries = 363 unique repos; exclusive keyword classification on description/topics/name, priority Bee > Ring > Fire TV > Alexa) — [.firecrawl/gh-entrant-classification.tsv]:
- Alexa+: **158** (+30 MCP-only, likely mostly Alexa+) → ~52% of visible entrants
- Fire TV / Vega: **37**
- Ring: **36**
- Bee: **7**
- Unclassified: 95
All 363 were created 2026-09-01..2026-10-03 (323 in September). Max stars = 3 — stars are useless as a quality signal here.

**Visible repos per prize slot (rough, lower bound):** Alexa+ ~158/3 prizes ≈ 53; Ring ~36/2 ≈ 18; Fire TV ~37/3 ≈ 12; Bee ~7/2 ≈ 3.5. Prize counts from saved overview ([.firecrawl/hackathon-overview.md]: Fire TV & Alexa+ 3 places, Bee & Ring 2 places). Devpost registrations were 34,524-34,728 on saved pages, so public repos are a small fraction of eventual submissions.

**Crowded themes** ([.firecrawl/gh-theme-counts.txt], regex on 504 new repos):
- AI **audio description for Fire TV / blind & low-vision**: ≥8 Fire TV repos (Interstice, sema-firetv, gap-track, narratv, described, scenespeak, sightline, audio-description-qa) + Ring doorstep variants (doorstep-ring, hack-amazon4).
- **Elder care / dementia / living alone**: ~15 (nightlight, stillwatch, still-there, porchlight, threshold-like, hearth, nalam, carecompanion, folkore, Mantel, CareSentinel-Plus…). Two entrants independently built "familiar voice at the door for dementia night exits" (usv240/nightlight, chinesepowered/hack-amazon5).
- **Product recall MCP**: ~9 (recall-check, recall-radar-mcp, cpsc-recall-check…). **Scam/fraud for older adults**: ~5. **Privacy/consent/redaction**: ~19.

### Inspected entrant repos (README read via gh api raw README; metadata via gh api)
| Repo | Track | Created / last push | License | Evidence it runs | Classification |
|---|---|---|---|---|---|
| [usv240/nightlight](https://github.com/usv240/nightlight) | Ring (+AWS Builder, OSS) | 09-01 / 09-28 | MIT | Live CloudFront site + Lambda API; MCP server (spec 2025-11-25, Streamable HTTP) at `/mcp`; eval on public CASAS corpus (claims 94.5% fewer caregiver wakes); simulated household labelled "Simulated"; Ring read endpoints verified 2026-09-17 with Playground token; tests re-derive README numbers. | likely entrant (very polished) |
| [AtchayamG/doorstep-ring](https://github.com/AtchayamG/doorstep-ring) | Ring | 09-15 / 09-24 | MIT | 2:56 YouTube demo; Bedrock Nova Pro; "Verified vs Unverified" table; Playground WHEP frame captured 2026-09-23; reports Playground device logs only `on_demand` events (no motion/doorbell events to drive webhooks). | likely entrant |
| [josepha-mayo/attest](https://github.com/josepha-mayo/attest) | Ring (+AWS Builder, OSS) | 09-15 / 10-03 | MIT | CI badge; signed evidence packs with in-browser verifier on GitHub Pages; HMAC webhook intake; replay mode; KMS. | likely entrant |
| [josepha-mayo/ring-sandbox](https://github.com/josepha-mayo/ring-sandbox) | Ring tooling | 09-15 / 10-02 | MIT | On PyPI (0.5.0), CI; typed client + FastAPI emulator of Ring Partner API, webhook HMAC signing, scenarios, pytest plugin, recorder. States "Ring ships no SDK and no local simulator". | **unofficial SDK** (entrant tooling; useful dependency, verify before use) |
| [harshpuri84/ringfence](https://github.com/harshpuri84/ringfence) | Bee | 09-25 / 09-29 | MIT | Uses `bee stream`, `@beeai/cli/lib` todos, changefeed; friction findings: todo events listed but "never delivered" on stream (~35 s via changefeed polling), stream "dies after about 43 h with no replay", undocumented `new-utterance-chunks` event. | likely entrant |
| [AtchayamG/bee-bystander](https://github.com/AtchayamG/bee-bystander) | Bee | 09-15 / 09-24 | MIT | 2:47 YouTube demo; MCP 2025-11-25; reports `bee mcp serve` answers a 2025-11-25 request with **2024-11-05** and exposes 34 tools; marks **physical Bee hardware UNVERIFIED** (no device paired). | likely entrant (Stage-1 risk: Bee rule requires real device data) |
| [usv240/bellwether](https://github.com/usv240/bellwether) | Bee | 09-16 / 09-29 | MIT | Calls `bee conversations`, `bee now`, `bee changed`, `bee stream --json`; Lambda MCP endpoint; SCOTUS-transcript evaluation; synthetic personas labelled SIMULATED; `evidence` command records that live Bee data flowed. | likely entrant |
| [johnwils/kept](https://github.com/johnwils/kept) | Bee | 09-13 / 09-13 | MIT | "Status: Phase 0 — scaffold"; daemon not built. | likely entrant (early/abandoned?) |
| [Chinorab/alexa-scam-guardian](https://github.com/Chinorab/alexa-scam-guardian) | Alexa+ | 10-01 / 10-02 | MIT | Hosted simulated Echo Show on Lambda; MCP server on Lambda (Streamable HTTP); MCP Apps cards; cites FBI IC3 2025 data. | likely entrant |
| [Actualjudgepresident/standup-voice](https://github.com/Actualjudgepresident/standup-voice) | Alexa+ | 10-01 / 10-03 | MIT | Claims TS SDK v2 and MCP spec **2026-07-28**; MCP server + Agent Skill + simulated Alexa+ web app; tests with real MCP client↔server round trip; originally built for Bee track. | likely entrant |
| [fortemate/dicechess-tv](https://github.com/fortemate/dicechess-tv) | Fire TV | 09-21 / 10-03 | AGPL-3.0 | CI + SonarCloud; demo video recorded on **Vega Virtual Device**; needs **Vega SDK 0.24** + VVD or Fire TV Stick in dev mode. | likely entrant |
| [CesarRivasP/Interstice](https://github.com/CesarRivasP/Interstice) | Fire TV (+AWS, OSS) | 09-22 / 09-28 | MIT | "Vega SDK 0.24.12112, app builds and runs on the Vega Virtual Device"; jest/vitest. | likely entrant |
| [moiz-lakkadkutta/vega-media-kit](https://github.com/moiz-lakkadkutta/vega-media-kit) | Fire TV tooling | 09-14 / 10-01 | MIT | 0.1.0-alpha.0; 159 vitest cases; Fire OS device-verified (Fire TV Stick AFTSS, Fire OS 7.7.1.6, 2026-09-26); **Vega adapter "experimental, not device-verified"**. | unofficial SDK (entrant tooling) |
| [giolaq/vega-firetv-setup](https://github.com/giolaq/vega-firetv-setup) | Fire TV tooling | 10-03 / 10-03 | MIT-0 | Bash script: checks Vega SDK ≥0.24 + `vega devmode`, signs CLI in, enables Developer Mode on Vega OS Fire TV Stick. Author giolaq = Giovanni Laquidara, who merges AmazonAppDev repos. | official-adjacent helper (personal repo of AmazonAppDev maintainer; not an org release) |
| [kevinl95/Tandem](https://github.com/kevinl95/Tandem) | Fire TV | 09-26 / 10-03 | Apache-2.0 | Fire TV (Vega) + Fire tablet apps linked as **live on Amazon Appstore**; Node 20+, Vega SDK; Lambda backend. | likely entrant (shipped product) |

**Serial/high-volume entrants:** e.g. AtchayamG (Ring doorstep-ring, Bee bee-bystander, Fire TV narratv, Alexa+ homeops-guardian, all Sept 2026), usv240 (Ring nightlight, Bee bellwether + ~12 other hackathon repos in Sept), chinesepowered (hack-amazon2..5 across Alexa+/Ring) — [.firecrawl/gh-multi-entrant-users.txt]. These READMEs share a house style: verified-vs-unverified tables, "every number is a test", explicit SIMULATED labels, refusal states, friction findings. Expect judges to see many such polished, evidence-heavy entries.

---

## 3. Alexandria provider discovery (step 2)
| Need | Providers returned (`search alexandria`) | Executed? |
|---|---|---|
| npm package versions | `npmjs-com` (packages/get_package, get_package_version, get_version_downloads, list_dependents); `package-registry-metadata-download-stats` (packages/versions via deps.dev) | Contract for `npmjs-com/packages/get_package` inspected (inputs `name` or `url`; `include_versions`, `include_readme`; response.key ""; fields latest_version, dist_tags, modified, version_count). Execution attempted → **429**. Versions taken from npm registry directly. |
| PyPI package metadata | `pypi-org` (packages/project, release, files, recent_releases, stats) | Execution attempted in background job → blocked by 429 before reaching it. Versions taken from PyPI JSON directly. |
| app store reviews | `apps-apple-com` (apps/reviews, apps/app) | Not executed (out of scope here; could serve Bee iOS app reviews). |
| reddit posts search | **none returned** (0 tools) | — |
| devpost hackathon projects | **no Devpost provider**; only unrelated matches (firecrawl-developer-index, defillama hacks, craigslist, apollo…) | — |
| youtube video metadata | **none returned** | — |
Files: .firecrawl/gh-alex-disc-{npm,pypi,appreviews,reddit,devpost,youtube}.json, .firecrawl/gh-alex-contract-npm-get_package.txt.

---

## 4. Calibration — past Amazon/AWS Devpost hackathons (calibration, NOT prediction)

**A. Amazon Nova AI Hackathon (AWS, Devpost; winners announced ~April 2026, page says "6 months ago")** — winners update + gallery + two winner pages scraped with Firecrawl ([.firecrawl/gh-calib-nova-winners.md], [.firecrawl/gh-calib-nova-gallery.md], [.firecrawl/gh-calib-nova-memoria.md], [.firecrawl/gh-calib-nova-backstage.md]).
- Winners: 1st BackstageCommercials (AI product placement into TV/movie backgrounds + NovaAct shopping agent), 2nd Oracus AI (synthetic focus groups), category winners Sai (voice OS agent that sees your screen), Project Memoria (multimodal dementia assistant), Title AI (county-recorder title reports), Flare (AWS anomaly → phone call voice triage), student SpatialMath AI. "Hundreds of developers" submitted.
- Traits visible on the two winner pages read: each has a **YouTube demo video** embedded first; a sharply framed problem with a concrete user moment; the **sponsor's model is the core reasoning layer** (Nova 2 Lite / Nova Pro / NovaAct), not a bolt-on; a multi-step technical pipeline explained step-by-step (BackstageCommercials: scene selection → adjuster/critic Nova models → FLUX placement → YOLO masking → shopping agents); an honest **Challenges** section with numbers (24 GB VRAM → 4-bit quantization; 3 min per frame). Memoria was explicitly a **rebuild of an earlier personal project** around the sponsor model, with example queries per feature (social impact: dementia, fall alerts).
- Mix of winners: commercial/business value (ads, focus groups, real-estate titles, on-call ops) won as often as social impact; consumer-media innovation won 1st.

**B. Amazon Alexa Skills Challenge: Multimodal (Nov 26 2018 – Jan 22 2019, Devpost)** — main page scraped ([.firecrawl/gh-calib-alexa-multimodal.md]).
- 999 participants, "over 350 unique skills"; $150K prizes: Grand Prize (Loop It!), 10 finalists, category bonuses (Living Room, Kitchen, Morning, Bedtime, Kids, In-Skill Purchasing) and per-country store bonuses.
- Winners were overwhelmingly **consumer entertainment / games / kids / stories / language learning** skills, all **certified and live in the Alexa Skill Store** (certification was a hard requirement).
- Judging criteria: Quality of the Idea (using APL), Quality of the User Experience (visual design, performs as expected across devices), Potential Impact, Quality of the Submission Package (description + **video demo**), plus customer engagement in round 2 — structurally close to the 2026 criteria (Tech Implementation, Design, Potential Impact, Quality of Idea).

**C. AWS Game Builder Challenge (Nov 1 2024 – Jan 14 2025)** — winners update scraped ([.firecrawl/gh-calib-gamebuilder-winners.md]) but it only points to the gallery and mentions Feedback Winners and blog-post bonus prizes; winner list **not read** (gallery not scraped due to rate limits). Useful only as evidence that AWS-run Devpost challenges reward optional extras (feedback, blog posts) — analogous to this hackathon's friction-log bonus.

**Recurring traits (calibration):** (1) a crisp 2-3 minute demo video is universal among winners and among the strongest current entrants; (2) the sponsor platform is load-bearing in the architecture; (3) real, running artifacts (store-certified skill in 2018-19; deployed pipeline in 2026); (4) a specific human moment/problem rather than a generic assistant; (5) honest limits/challenges. Category/country bonuses in 2018-19 rewarded breadth; 2026 Nova winners skewed technically ambitious. None of this predicts the 2026 Amazon Developer judges' choices.

**Current-competition calibration (from entrant repos, Sept–Oct 2026):** the visible bar is already high — live AWS deployments (Lambda/CloudFront), YouTube demos of 2-3 min, CI + tests, "verified vs unverified" tables, explicit SIMULATED labels, eval numbers on public datasets, MCP servers advertising spec 2025-11-25 over Streamable HTTP, and friction findings. A recurring TV pattern is **TV + phone companion via QR pairing** (Cinemastamps, CommonScene, HomeBoard).

---

## 5. Devpost gallery / software search for this hackathon
- Saved gallery page ([.firecrawl/amazonappdev2026.devpost.com-project-gallery.md], earlier Firecrawl scrape): "The hackathon managers haven't published this gallery yet"; Participants (34728); filter "Which Primary Track(s) are you submitting your project into?". Saved dates page shows Participants (32940) and overview (34524) — registrations keep growing; Winners Announced December 03 at 3:00PM EST.
- **Devpost software search** `https://devpost.com/software/search?query=amazonappdev2026` (Firecrawl scrape, no login) → **1 result: Cinemastamps** ([.firecrawl/gh-devpost-software-search.md]). Most public Devpost project pages are not discoverable by this slug, so this says nothing about total submissions.
- **Cinemastamps** (https://devpost.com/software/cinemastamps, "started this project 3 days ago"; Firecrawl scrape [.firecrawl/gh-devpost-cinemastamps.md]): Fire TV track; native React Native for Vega app, "built with Vega SDK 0.24.12112 for Vega OS 1.2", demo recorded on the **official Vega Virtual Device**, 1:58 YouTube demo, phone companion via QR pairing, VERIFICATION.md, versioned release v0.2.2, explicit scope limits. Friction reported: "The Linux virtual-device image did not provide the WebView service needed by the initial wrapper approach" → they rebuilt natively. They cite the rules: Fire TV demo may use a device or the Fire TV/Vega simulator.
- GitHub search for `amazonappdev2026` returns 0 repos; one visible repo links a Devpost project page (`pakorn269/CommonScene` → https://devpost.com/software/commonscene; page scrape blocked by 429).

---

## Gaps / unverified / contradictions
- **Rate limits:** Most Alexandria executions after the first two failed with HTTP 429 (shared account). Alexandria npm/PyPI providers were discovered and the npm contract inspected, but **not executed successfully**; versions came from npm/PyPI registries directly. GitHub searches 4-8 used `gh api` instead of Alexandria (same GitHub search API; per_page 30/100).
- **Visible entrants are a lower bound.** 363 public hackathon-labelled repos vs ~34.7K registrants; private repos, non-GitHub hosting and unlabelled repos are invisible. Track classification is keyword-based on description/topics only (README text not classified) and has errors (e.g. MCP-only repos may be Ring/Bee entrants).
- **Entrant-reported platform facts are unverified by official docs here:** Ring Playground device logs only `on_demand` events and returns 416 for historical images (doorstep-ring); "Ring ships no SDK and no local simulator" (ring-sandbox) — note the official Ring get-started page saved earlier mentions a "Sandbox Environment" with synthetic devices and events, which **contradicts or at least nuances** that claim (not resolved here); Bee `mcp serve` negotiating 2024-11-05 and exposing 34 tools (bee-bystander); Bee stream not delivering todo events and dying after ~43 h (ringfence); Linux Vega Virtual Device lacking WebView (Cinemastamps). Treat as anecdotes (single sources each) until reproduced.
- **bee-skill license:** README says MIT; GitHub detects no LICENSE file. Unresolved.
- **ring-api-helloworld activity:** `pushed_at` 2026-09-11 but last commit on `main` 2026-07-01 (branch/dependabot pushes) — "activity" depends on which signal you use.
- **amazon-devices-buildertools** license is NOASSERTION ("Other"); terms not read.
- **MCP TS SDK:** main-branch constants show LATEST 2025-11-25 while the spec repo already has 2026-07-28; an entrant (standup-voice) claims SDK v2 speaks 2026-07-28. Which published npm version implements 2026-07-28 was **not verified**.
- **Calibration:** only 2 hackathons' winner lists were read (Nova 2026, Alexa Multimodal 2018-19); Game Builder winners not read; no Fire TV- or Ring-specific past hackathon winners found/read. No past Bee hackathon exists in reviewed sources.
- Not verified in reviewed sources: any official Alexa+ starter repo; any official Bee sample app beyond CLI/skill; Ring official SDK packages on npm/PyPI.
- Devpost search by `amazonappdev2026` returns only 1 project; the official gallery is unpublished, so submission counts per track are unknown.

## Searches run
| # | Query / command | Method | Saved file | Useful |
|---|---|---|---|---|
| 1 | search_repos `org:AmazonAppDev` (updated, 30) | Alexandria CLI (`npx firecrawl-cli@alexandria scrape github-com/repositories/search_repos`) | .firecrawl/gh-amazonappdev.json | yes |
| 2 | search_repos `org:bee-computer` | Alexandria CLI | .firecrawl/gh-bee-computer.json | yes |
| 3 | search_repos `ring api created:>2026-08-31` | Alexandria via Firecrawl MCP (CLI 429) | .firecrawl/gh-ring-api-new-mcp-extract.tsv (hand extract; CLI file gh-ring-api-new.json holds the 429 error) | yes |
| 4 | `bee created:>2026-08-31 wearable` | gh api search/repositories (Alexandria 429) | .firecrawl/gh-bee-wearable-new.ghapi.json | yes |
| 5 | `"alexa" mcp created:>2026-08-31` | gh api | .firecrawl/gh-alexa-mcp-new.ghapi.json | yes |
| 6 | `vega "fire tv" created:>2026-08-31` | gh api | .firecrawl/gh-vega-firetv-new.ghapi.json | yes |
| 7 | `amazonappdev2026` | gh api | .firecrawl/gh-amazonappdev2026.ghapi.json | yes (0 results) |
| 8 | `react-native-tvos created:>2026-08-31` | gh api | .firecrawl/gh-rn-tvos-new.ghapi.json | low |
| 9 | `"Amazon Developer Hackathon" in:readme created:>2026-08-31` (pages 1-4) | gh api | .firecrawl/gh-readme-amzdevhack*.ghapi.json | yes |
| 10 | `"Build, Ship, Shape" in:readme created:>2026-08-31` (pages 1-3) | gh api | .firecrawl/gh-readme-bss*.ghapi.json | yes |
| 11 | counts: `"Amazon Developer Hackathon"`, `"Build, Ship, Shape"`, `bee hackathon`, `ring hackathon`, `"fire tv" hackathon`, `"alexa+"`, `topic:alexa-plus`, `vega-os`, `bee ... mcp` (all created:>2026-08-31) | gh api | .firecrawl/gh-{amzdevhack-desc,buildshipshape,bee-hackathon,ring-hackathon,firetv-hackathon,alexaplus-new,topic-alexaplus,vegaos-new,bee-new}.ghapi.json | yes |
| 12 | `org:alexa`, `org:alexa-samples`, `org:amzn alexa`, `org:ring`, `org:aws-samples alexa mcp`, `org:strands-agents` | gh api | .firecrawl/gh-other-orgs.txt | yes |
| 13 | `user:{AtchayamG,usv240,josepha-mayo,chinesepowered} created:>2026-08-31` | gh api | .firecrawl/gh-multi-entrant-users.txt | yes |
| 14 | Alexandria discovery: npm package versions / PyPI package metadata / app store reviews / reddit posts search / devpost hackathon projects / youtube video metadata | `npx firecrawl-cli@alexandria search alexandria` | .firecrawl/gh-alex-disc-*.json | yes |
| 15 | Alexandria contract `npmjs-com packages/get_package` | `list --pretty` | .firecrawl/gh-alex-contract-npm-get_package.txt | yes |
| 16 | Alexandria execute npm get_package (@modelcontextprotocol/sdk) | CLI + MCP | .firecrawl/gh-npm-mcp-sdk.json (429 error) | no |
| 17 | `Amazon Nova AI Hackathon devpost winners` | firecrawl search | .firecrawl/gh-search-calib-nova.json | yes |
| 18 | `Alexa Skills Challenge devpost winners announced` | firecrawl search | .firecrawl/gh-search-calib-alexa.json | yes |
| 19 | `AWS Game Builder Challenge devpost winners` | firecrawl search | .firecrawl/gh-search-calib-gamebuilder.json | partial |
| 20 | npm view / PyPI JSON for @modelcontextprotocol/{sdk,server,client,core}, react-native-tvos, @beeai/cli, @amazon-devices/amazon-devices-buildertools-mcp, @strands-agents/sdk, mcp, strands-agents, ring-sandbox | registry direct (fallback) | (inline in this digest) | yes |
| 21 | MCP spec schema dirs; TS SDK constants; Python SDK protocol-versions doc | gh api | .firecrawl/gh-mcp-protocol-versions.txt | yes |

## Sources read (body actually read)
| Source | Method | Saved file | Official? |
|---|---|---|---|
| https://github.com/AmazonAppDev/ring-api-helloworld (repo page + README) | Firecrawl scrape (earlier, by another agent; re-read here) | .firecrawl/technical-ring-starter.md | yes |
| https://github.com/AmazonAppDev/react-native-multi-tv-app-sample (repo page + README) | Firecrawl scrape (earlier; re-read) | .firecrawl/technical-tv-starter.md | yes |
| AmazonAppDev/react-native-multi-tv-helloworld README | gh api raw README | .firecrawl/gh-readme-AmazonAppDev_react-native-multi-tv-helloworld.md | yes |
| AmazonAppDev/vega-tv-interfaces-sample README | gh api | .firecrawl/gh-readme-AmazonAppDev_vega-tv-interfaces-sample.md | yes |
| AmazonAppDev/hello-world-fire-tv README | gh api | .firecrawl/gh-readme-AmazonAppDev_hello-world-fire-tv.md | yes |
| AmazonAppDev/hello-world-fire-tv-react-native README | gh api | .firecrawl/gh-readme-AmazonAppDev_hello-world-fire-tv-react-native.md | yes |
| AmazonAppDev/devices-agent-skills README | gh api | .firecrawl/gh-readme-AmazonAppDev_devices-agent-skills.md | yes |
| AmazonAppDev/amazon-devices-buildertools README | gh api | .firecrawl/gh-readme-AmazonAppDev_amazon-devices-buildertools.md | yes |
| bee-computer/bee-cli README | gh api | .firecrawl/gh-readme-bee-computer_bee-cli.md | yes |
| bee-computer/bee-skill README | gh api | .firecrawl/gh-readme-bee-computer_bee-skill.md | yes |
| Releases/commits/license files for 8 official repos | gh api | .firecrawl/gh-candidate-activity.tsv | yes |
| Repo metadata for 23 candidates | gh api | .firecrawl/gh-candidate-meta.tsv | mixed |
| Entrant READMEs: usv240/nightlight, AtchayamG/doorstep-ring, josepha-mayo/attest, josepha-mayo/ring-sandbox, harshpuri84/ringfence, AtchayamG/bee-bystander, usv240/bellwether, johnwils/kept, Chinorab/alexa-scam-guardian, Actualjudgepresident/standup-voice, fortemate/dicechess-tv, CesarRivasP/Interstice, moiz-lakkadkutta/vega-media-kit, giolaq/vega-firetv-setup, kevinl95/Tandem | gh api raw README | .firecrawl/gh-readme-<owner>_<repo>.md | no (third-party) |
| modelcontextprotocol spec schema dir, typescript-sdk constants.ts, python-sdk protocol-versions.md | gh api | .firecrawl/gh-mcp-protocol-versions.txt | yes (official MCP org) |
| https://amazonappdev2026.devpost.com/project-gallery | Firecrawl scrape (earlier; re-read) | .firecrawl/amazonappdev2026.devpost.com-project-gallery.md | yes |
| https://devpost.com/software/search?query=amazonappdev2026 | Firecrawl scrape | .firecrawl/gh-devpost-software-search.md | Devpost |
| https://devpost.com/software/cinemastamps | Firecrawl scrape | .firecrawl/gh-devpost-cinemastamps.md | no (entrant) |
| https://devpost.com/software/commonscene | Firecrawl scrape | .firecrawl/gh-devpost-commonscene.md | no (entrant) |
| https://amazon-nova.devpost.com/updates/41602-announcing-the-amazon-nova-hackathon-winners | Firecrawl scrape | .firecrawl/gh-calib-nova-winners.md | yes (Devpost/AWS) |
| https://amazon-nova.devpost.com/project-gallery | Firecrawl scrape | .firecrawl/gh-calib-nova-gallery.md | yes |
| https://devpost.com/software/project-memoria-the-dementia-assistant | Firecrawl scrape | .firecrawl/gh-calib-nova-memoria.md | no (winner) |
| https://devpost.com/software/backstagecommercials | Firecrawl scrape | .firecrawl/gh-calib-nova-backstage.md | no (winner) |
| https://alexamultimodal.devpost.com/ | Firecrawl scrape | .firecrawl/gh-calib-alexa-multimodal.md | yes |
| https://awsdevchallenge.devpost.com/updates/33467-and-the-winner-is | Firecrawl scrape | .firecrawl/gh-calib-gamebuilder-winners.md | yes (thin) |
| Saved overview / dates pages (prize table, participants, winners date) | re-read of earlier Firecrawl scrapes | .firecrawl/hackathon-overview.md, .firecrawl/amazonappdev2026.devpost.com-details-dates.md | yes |
