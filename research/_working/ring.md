# Ring track: what an entrant can do with Ring developer tooling, plus the Ring Appstore landscape

KEY=ring · PREFIX=RING · Researched 2026-10-03 (Asia/Kolkata). Every source was retrieved on 2026-10-03.
Scope: Ring Partner API ("Amazon Vision API"), the Developer Playground, webhooks, media, chimes and sensors, testing and certification, regional limits, the starter repo, the UX guide, Appstore rivals and community Q&A.

Confidence: **H** means an official doc states it explicitly. **M** means it is official but undated, inferred, or depends on a single statement. **L** means it comes from an anecdote or third party.

---

## 0. Bottom line for planning (decision-critical)

1. **A simulator path exists and the hackathon accepts it.** The Devpost FAQ names the "Ring Developer Playground" as an acceptable simulator. A demo may use either the Playground or a real device ([FAQ](https://amazonappdev2026.devpost.com/details/faqs)). The Playground was released on 2026-05-28. Per the release notes it issues a **30-minute OAuth token** without creating an app, doing account linking or holding a Ring subscription. It also offers **"live view event simulation for Package, Vehicle, and Motion event types"** over WHEP ([release notes](https://developer.amazon.com/docs/ring/release-notes.html#developers-playground)). The Playground console itself sits behind Amazon Developer sign-in, so its UI was **not inspected**. (M)
2. **Production-style integration is heavy and US-centric.** It needs a registered app (identity verification with a government photo ID), a Token Exchange URL, a nonce-based Account Link URL with mandatory sign-in, an HTTPS webhook, and staging users. Each staging user needs an active **Ring Protection plan**, and the Test phase states **"Currently we only support devices located in the US."** ([develop](https://developer.amazon.com/docs/ring/develop.html#testing-process)). The Ring Appstore itself is reachable only from US locations ([FAQ Q21](https://developer.amazon.com/docs/ring/developer-faq.html)). (H)
3. **The API is read-mostly.**
   - Available: device discovery and status, coarse location, read-only configurations, event metadata, receive-only live video (WHEP/RTSPS, capped at **30 s on battery devices and 60 s on line-powered ones**), MP4 clip download, snapshot download, and **chime playback of pre-provisioned slot audio** (Early Access).
   - Not found in any reviewed doc: lock actuation, alarm or mode changes, sirens or lights, two-way talk, TTS on a chime, facial recognition / Familiar Faces, package classification, or continuous audio.
   - Device capabilities are explicitly read-only ([FAQ Q8](https://developer.amazon.com/docs/ring/developer-faq.html)). (H)
4. **The "computer vision APIs" are raw media plus motion sub-types.** "Amazon Vision API" is the API host name (`api.amazonvision.com`). The only classification exposed is the motion `sub_type` (`motion`/`human`/`vehicle`/`other_motion`), and event history adds `animal`. Any richer understanding (packages, falls, descriptions) has to be your own model running on the watermarked media. (M-H)
5. **Webhook security is precise.**
   - Header: `X-Signature: sha256=<hex>`, an HMAC-SHA256 computed over the **raw request body bytes** with the app's HMAC signing key.
   - Response: return 2xx within **5 s**. 4xx is treated as permanent and not retried. 5xx or a timeout is retried 6 times (1s, 5s, 30s, 2m, 10m, 1h).
   - After retries run out, events go to a dead-letter queue (DLQ) held for 72 h.
   - Dedupe on `meta.request_id`.
   - No ordering guarantee is documented. ([Notifications](https://developer.amazon.com/docs/ring/api-documentation.html#notifications)) (H)
6. **New risks inside the hackathon window:**
   - **TAKE encryption** started rolling out in September 2026 as the default for all customers. On TAKE devices, partner video requests return encrypted content (no clips, snapshots or live view). E2EE devices disappear from the API entirely.
   - **A mandatory watermark** has been on all partner media since 2026-06-08.
   - Sensors and chimes are **Early Access** and cannot be published until dynamic scopes reach GA.

---

## 1. Account and auth model

| Item | Finding | Source | Conf. |
|---|---|---|---|
| Developer registration | You register at developer.amazon.com/ring/console with contact info, business details and use cases. **Identity verification with a government photo ID is required "before you can create or submit applications."** | [get-started](https://developer.amazon.com/docs/ring/get-started.html#account-identity-verification), [configure](https://developer.amazon.com/docs/ring/configure.html) | H |
| "Free" access | The Devpost resources page says "Creating a free Ring account gets you access to the Ring (Amazon Vision) APIs." Publishing is free, and Ring takes a 10% revenue share on paid subscriptions. | `.firecrawl/technical-resources.md` L284; [get-started FAQ](https://developer.amazon.com/docs/ring/get-started.html) | M |
| Credentials | Client ID, Client Secret and HMAC Signing Key are **shown once**. They cannot be regenerated; you delete and recreate the app instead (before certification). They are shared between staging and production. | [API doc §1.2](https://developer.amazon.com/docs/ring/api-documentation.html#12-obtain-credentials), [configure](https://developer.amazon.com/docs/ring/configure.html#replacing-your-app-credentials) | H |
| Default linking: one-way (Ring-driven) | 1. The user installs the app in the Ring Appstore, consents to scopes and selects devices. 2. Ring POSTs an auth code to your **Token Exchange URL** (the code lives 60 s). 3. You exchange it at `POST https://oauth.ring.com/oauth/token` with `client_id` and `client_secret`. 4. You call `GET /v1/users/me` to get the Account ID. 5. Ring redirects the user to your **Account Link URL** with `nonce` and `time` (ms). 6. The **user must sign in or create an account** first; only then do you match the nonce against unclaimed tokens. The nonce is `HMAC-SHA256(K, "<time>:<account_id>")`, URL-safe Base64 with no padding, valid for 600 s. 7. Then POST `/v1/accounts/me/app-integrations`, which moves the integration to `awaiting`. 8. Then PATCH `status: completed`, which is **mandatory**. | [API doc §5–6](https://developer.amazon.com/docs/ring/api-documentation.html#6-account-linking-flow-one-way-account-linking) | H |
| Partner-initiated OAuth 2.0 + PKCE | A standard auth-code flow with PKCE S256. It is **invitation-only**: you request allowlisting by email with your Vendor ID and App ID. It supports free apps only. | [API doc](https://developer.amazon.com/docs/ring/api-documentation.html#partner-initiated-oauth-20-account-linking) | H |
| Token lifetimes | Auth code 60 s. Access token about 4 h (`expires_in: 14400`). Refresh token about 30 days; once it expires the user must re-link. Refresh tokens are **not** valid as Bearer tokens (you get a 401). | [API doc §5.3, Authentication](https://developer.amazon.com/docs/ring/api-documentation.html#authentication) | H |
| Server-side requirement | **All calls to `api.amazonvision.com` and `oauth.ring.com` must be server-to-server**, because CORS blocks browser calls. | [API doc Overview warning](https://developer.amazon.com/docs/ring/api-documentation.html#overview) | H |
| Browser-only linking | App-to-app login is not supported. | [FAQ Q1](https://developer.amazon.com/docs/ring/developer-faq.html) | H |
| Scopes (dynamic, Early Access since 2026-08-24) | **Cameras and Doorbells** is one group toggled as a whole: Motion Events, Doorbell press, Livestream, Video Download. **Sensors** are toggled per type. **Chimes** has an optional **Chime Controls** add-on. **Account and Lifecycle** is always granted. Scopes can be edited until certification; after that they can be added but not removed. Snapshots are not listed as a separate scope (not verified which scope covers them, probably Video Download). Apps using dynamic scopes **can only be published once dynamic scopes reach GA**. | [configure §API Scopes](https://developer.amazon.com/docs/ring/configure.html#api-scopes), [release notes 2026-08-24](https://developer.amazon.com/docs/ring/release-notes.html) | H |
| Device eligibility | Users can only share devices that have an active **Ring base plan**. This is stated in the partner-initiated OAuth section, the error is `ring_base_plan_required`. Staging users and private-app accounts also need a Ring Protection plan or a trial (about 30 days). | [API doc](https://developer.amazon.com/docs/ring/api-documentation.html#partner-initiated-oauth-20-account-linking), [develop](https://developer.amazon.com/docs/ring/develop.html#prerequisites), [FAQ Q16/Q18](https://developer.amazon.com/docs/ring/developer-faq.html) | H |
| Unlink | `DELETE /v1/accounts/me/app-integrations` works only for partner-initiated OAuth apps. One-way apps get a 403. (Added 2026-09-15.) | [release notes](https://developer.amazon.com/docs/ring/release-notes.html) | H |

## 2. Endpoints (base `https://api.amazonvision.com`, JSON:API, `Authorization: Bearer`)

- **Devices:** `GET /v1/devices` (`?include=status,capabilities,location,configurations`), `/v1/devices/{id}`, `/status`, `/capabilities` (codecs, motion detection, image enhancements, multi-camera `components`), `/location` (**country and state only**, never city or GPS), `/configurations` (motion zones, privacy zones, image settings, **read-only**).
- **Event history:** `GET /v1/history/devices/{id}/events`. Returns metadata only. Types are `motion` (`.human`, `.vehicle`, `.animal`, `.other_motion`), `on_demand` (live view) and `ding`. Results come newest first with cursor pagination. Results are **time-gated to after the user's consent date**. Sensor events are not included. ([Event History](https://developer.amazon.com/docs/ring/api-documentation.html#event-history))
- **Live video:**
  - WHEP: `POST /v1/devices/{id}/media/streaming/whep/sessions` (SDP offer, returns 201 with SDP answer and a `Location` header), then DELETE the session URL to close it.
  - RTSPS: `rtsps://video.rtsp.amazonvision.com:322/v1/devices/{id}/stream` (TCP-interleaved, token sent at DESCRIBE).
  - Both are **receive-only** video with optional receive-only audio. Bidirectional `sendrecv` is not supported. **Sessions last at most 30 s on battery devices and 60 s on line-powered devices.** ([Live Video](https://developer.amazon.com/docs/ring/api-documentation.html#live-video))
- **Clips:** `POST /v1/devices/{id}/media/video/download`. Returns MP4, up to 15 min per request, at most 1920×1080 and 25 fps, with optional audio. **It does not trigger recording** (a 416 means there was no recording). The recommended workflow is to start a live session (which triggers recording on supported devices), stop it, and then download. ([Media Clips](https://developer.amazon.com/docs/ring/api-documentation.html#media-clips))
- **Snapshots:** `POST /v1/devices/{id}/media/image/download`. Returns a 303 to a pre-signed URL that serves the JPEG or PNG. Modes are `at_timestamp` and `latest_in_range`, within the last 180 days and a window of at most 24 h. The `X-Media-Origin` header is `recording` or `snapshot`. It retrieves existing images only. ([Image Snapshots](https://developer.amazon.com/docs/ring/api-documentation.html#image-snapshots))
  - Ring staff confirm in the community that a request before the consent boundary returns `403 TIME_RANGE_NOT_AUTHORIZED` and that no endpoint exposes the consent date. The recommended pattern is to use the `motion_detected` webhook timestamp as `start_timestamp` ([community thread, 2026-05-26](https://community.amazondeveloper.com/t/obtaining-a-camera-snapshot/28387)).
- **Chime:** `POST /v1/devices/{id}/media/audio/playback` with `audio_ref` (needs Chime Controls).
- **Account:** `GET /v1/users/me` (Account ID, first and last name, email, phone), `POST`/`PATCH /v1/accounts/me/app-integrations`, `GET /v1/accounts/me/subscriptions`.
- **Watermark:** all live video, clips and snapshots have carried a **non-removable watermark** since 2026-06-08 (Ring logo, Device ID, App Name, timestamp). Ring warns that CV models may need retraining ([release notes 2026-06-08](https://developer.amazon.com/docs/ring/release-notes.html)).
- **"Amazon Vision" is the API brand and host, not a CV inference API.**
  - No endpoint returns object labels, bounding boxes, packages, faces or text descriptions. A grep of the 464 KB API reference found no such fields.
  - The only classification is the motion `sub_type`. Webhooks list `motion`, `human`, `vehicle`, `other_motion`; event history also lists `animal`.
  - The Devpost update mentions "the Ring Appstore and its computer vision APIs" ([updates](https://amazonappdev2026.devpost.com/updates)). Read that as access to raw media for your own CV.
  - The starter repo's "video processors" (MediaPipe) run client-side on the stream.

## 3. Webhooks

- **Event types (v1.1 payload):** `motion_detected` (`attributes.sub_type`, plus `component_ids` on Ring Elite), `button_press`, `device_added`, `device_removed`, `device_online`, `device_offline`, `app_integration_added`, `app_integration_removed`, `subscription_activated`, `subscription_deactivated`.
- **Sensor events (Early Access):** `contact_sensor_faulted/cleared`, `tamper_detected/cleared`, `flood_*`, `freeze_*`, `temperature_*`, `humidity_*`, `pm25_*`, `co_*`.
- **Chimes** deliver only `device_added` and `device_removed`.
- **Not documented:** any package, person-at-door or ding-answered event, and any "live view started" webhook. Package detection is a consumer Ring plan feature and is not verified as exposed.
- **Signature:**
  - Header is `X-Signature: sha256=<hex>`.
  - The value is HMAC-SHA256 over the **raw body bytes**, keyed with the HMAC Signing Key, hex-encoded, compared in constant time.
  - The docs warn that signing re-serialized JSON makes every check fail.
  - The same key is used for nonces, but nonces use URL-safe Base64 with no padding.
  - Source: [Webhook Authentication](https://developer.amazon.com/docs/ring/api-documentation.html#webhook-authentication--verification). (H)
- **Endpoint requirements:**
  - HTTPS with TLS 1.2 or later, publicly reachable, accepts POST `application/json`.
  - **Must respond within 5 s** or the delivery counts as failed.
  - The URL is set in the portal and cannot be changed via API.
  - A webhook URL is required even if you plan to poll; in that case return 200 and use Event History.
- **Response semantics:**
  - 2xx means delivered.
  - **4xx is permanent with no retry.** Ring may disable the endpoint after 10 or more consecutive failures over 24 h.
  - 5xx or a timeout is retried.
- **Retries:** 7 attempts in total (immediate, 1 s, 5 s, 30 s, 2 min, 10 min, 1 h). After that the event goes to a **dead-letter queue (DLQ) kept for 72 h**, and replays require contacting your Ring rep.
- **Idempotency:** "must be idempotent … Use the `meta.request_id` field to deduplicate."
  - Event pages also suggest "`request_id` or event `id`". The event `data.id` is shaped like `<device_id>_<type>_<timestamp>`.
  - The docs do not say whether a retried delivery reuses the same `request_id`. Not verified.
  - For sensors, deduping on `request_id` is described as *required*, because there is no history to reconcile against.
- **Ordering:** no ordering guarantee is documented. The subscription-webhook section says to refetch state "even if webhooks arrive out of order or are duplicated." (M)
- **Delivery caveats:**
  - Motion events fire only inside the configured motion zones ([FAQ Q14](https://developer.amazon.com/docs/ring/developer-faq.html)).
  - **Smart Alerts settings can suppress motion events to partners, and no API reports this.** Ring staff confirmed it as the most common cause of missing `motion_detected` in staging ([community, 2026-07-13](https://community.amazondeveloper.com/t/issue-testing-staging-app-with-motion-events/28731)); the [UX guide](https://developer.amazon.com/docs/ring/ux-design-guide.html) says the same.
  - `device_offline` lags the actual loss of connectivity, and sensors send `device_online` as a heartbeat ([release notes 2026-08-24](https://developer.amazon.com/docs/ring/release-notes.html)).

## 4. Explicit availability check (third-party exposure)

| Capability | Status in reviewed docs | Notes |
|---|---|---|
| Smart-lock actuation | **Not verified in reviewed docs** (no lock endpoints; capabilities are read-only per FAQ Q8) | Access-control apps such as Seam control locks through their own lock integrations, not through Ring |
| Facial recognition / Familiar Faces | **Not verified in reviewed docs** as exposed | A consumer Ring Pro feature ([plans](https://ring.com/plans), [intelligent features](https://ring.com/support/articles/de7qi/intelligent-features)). Partner biometric apps face heightened review under Content Policy §4.2. Cross-account face correlation is prohibited (§1.2.3). |
| Two-way talk / speech playback via camera | **Not available**: live media is `recvonly` only and "Bidirectional media … is not supported" | — |
| Chime playback | **Available (Early Access)**: plays only audio already assigned to your app's slots (`ring-appstore-event-1/2`). Volume, snooze and slot audio are read-only. Assigning audio to a slot is "not a device API operation." | Arbitrary TTS on a chime is not verified |
| Continuous audio | **Not verified.** Audio is available only inside live sessions (30/60 s) and as an optional track in clip downloads | — |
| Live view streaming | **Available**: WHEP or RTSPS, 30 s (battery) / 60 s (line-powered) per session, reconnect for longer viewing | Bandwidth and battery cautions apply |
| Alarm / Mode changes, siren, lights | **Not verified in reviewed docs** (no endpoints) | "Device Modes" is a consumer plan feature |
| Package detection | **Not verified** (sub-types are motion/human/vehicle/other_motion, plus animal in history) | The Playground simulates a "Package" event type per the release notes |
| Video Descriptions / Video Search | **Not verified** as exposed (consumer Ring Pro features) | — |
| Device configuration writes (zones, privacy zones, HDR, night vision) | **Not available**: read-only. The UX guide requires sending users to the Ring app for these. | — |

## 5. Rate limits, testing tools, simulator, certification, publishing

- **Rate limit:** 100 TPS per partner `client_id` across all endpoints. Responses include `X-RateLimit-*` headers and 429 with `Retry-After` ([API Reference](https://developer.amazon.com/docs/ring/api-documentation.html#rate-limiting)). The glossary says "No rate limits apply in sandbox" ([get-started](https://developer.amazon.com/docs/ring/get-started.html)).
- **Tools:** there is no official SDK ("There is no official Ring Partner SDK"). Use curl, Postman or Bruno.
  - The Ring Appstore MCP server is a **documentation** MCP backed by a Bedrock Knowledge Base. It exposes `search_docs` and `get_doc` at `https://knowledge.appstore-mcp.ring.amazon.dev/mcp` (streamable-http) and does not control devices. The Kiro CLI has a known authorization bug ([ring-mcp](https://developer.amazon.com/docs/ring/ring-mcp.html)).
- **Playground** (`developer.amazon.com/ring/console/playground`, released 2026-05-28):
  - Provides a 30-min token, an API explorer with curl and live JSON, and live-view event simulation for Package, Vehicle and Motion events.
  - Does not require creating an app, account linking, or a subscription.
  - Requires Amazon Developer sign-in; the scrape hit the sign-in wall (`.firecrawl/ring-playground.md`).
  - The starter README says the Playground token "works with all Ring APIs." (M)
  - **Contradiction:** a third-party hackathon demo video says "Ring sandbox can't deliver events or footage" and simulated events, snapshots and chime itself ([Describe My Door, YouTube 2026-09-16](https://m.youtube.com/watch?v=0lSdXD05W7o)). (L)
- **Sandbox:** the get-started glossary describes a "Sandbox Environment" with "synthetic Ring devices and events." The develop page lists only "Developer testing – Use your personal Ring account and devices." It is unclear whether the sandbox is the Playground.
- **Test phase (public apps):**
  - Up to 10 staging users added through "Log in with Ring" (Ring email/password plus 2FA).
  - Requires an active Ring Protection plan and "Only US Located Devices".
  - No purchase is needed for staging as of 2026-09-11.
  - Staging-user add flow outage, June 2026: the reporter first saw it on 2026-06-01 and confirmed it working again on 2026-06-09 ([community](https://community.amazondeveloper.com/t/unable-to-add-test-users-to-ring-staging/28459)).
- **Private apps** (since 2026-07-21):
  - No certification and no public listing.
  - Lifecycle is Configure, then Build, then **Connect** (allowlist up to 10 Ring accounts; the release note said 5, so the sources contradict each other).
  - Needs the "Basic Ring plan".
  - publish.html says "Available to Ring accounts from any country." FAQ Q19 says the Appstore is reachable only from the US.
  - Still needs an Account Link URL and a Token Exchange URL ([publish](https://developer.amazon.com/docs/ring/publish.html#private-use-apps), [FAQ Q15–20](https://developer.amazon.com/docs/ring/developer-faq.html)).
- **Certification:**
  - A Privacy & Legal questionnaire with 5 tabs: General, Data processing, **AI governance**, Data protection, Third parties.
  - Reviewer notes covering account creation, linking and an end-to-end test.
  - Ring tests your **production** account-linking endpoints.
  - "90% of submissions are reviewed in less than 48 hours."
  - Material changes need 45 days' notice ([certify](https://developer.amazon.com/docs/ring/certify.html)).
- **Publishing:**
  - Distribution is **US only** (nationwide or by state).
  - Rollout options: gradual (10/30/70/100%), beta (an invite URL, up to 10 users), or full.
  - Marketing approvals go to the Ring PR team 10–12 business days ahead ([publish](https://developer.amazon.com/docs/ring/publish.html)).
- **Not needed for the hackathon.** The rules require a working app shown on a simulator or device, and the repo must call Ring tech at runtime ([rules](https://amazonappdev2026.devpost.com/rules)).

## 6. Regional availability (India-based entrant)

- **Test phase:** "Currently we only support devices located in the US." (develop.html) (H)
- **Ring Appstore:** "only reachable from locations within the US. Users outside of the US are forwarded to the Ring top page." (FAQ Q21) (H)
- **Distribution:** "currently limited to the US. International locations are not yet supported." (publish.html) (H)
- **Private apps:** "Available to Ring accounts from any country" (publish.html). This contradicts the US-only test-phase rule and shows the docs are inconsistent. (M)
- **Ring's consumer country selector** lists US, CA, MX, 17 European entries, SA, ZA, UAE, AU/NZ and JP. **India is not listed** ([ring.com/country-selector](https://ring.com/country-selector), undated). (M)
- **Whether someone in India can create a Ring consumer account or use the Playground is not verified in the reviewed sources.** The Playground requires an Amazon Developer login and its regional gating was not observed.
- The hackathon itself is global. Ineligible residents are listed (Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, and OFAC-sanctioned countries), and India is not among them ([rules §3](https://amazonappdev2026.devpost.com/rules)).

## 7. ring-api-helloworld starter ([GitHub](https://github.com/AmazonAppDev/ring-api-helloworld))

- **License and activity:** MIT (README and LICENSE link; generated from the amazon-archives MIT-0 template). Last commit 2026-07-01 (a dependabot merge). 12 commits, 17 stars, 10 forks.
- **Language:** Python 3.8+ scripts using `requests`, plus a Next.js 14 (App Router), TypeScript, Tailwind and Zod web app. Video uses WebRTC/WHEP and MediaPipe Hands. Events go over SSE.
- **Run (Playground mode):**
  1. Get a token from the Playground ("Generate Token", about 30 min).
  2. Scripts: `cd scripts && pip install -r requirements.txt && python explore_apis.py --token "eyJ..."`. This covers list devices, status, capabilities, location, configurations, event history and user profile, and each script prints the equivalent curl.
  3. Web: `npm install`, `cp .env.example .env.local`, set `RING_ACCESS_TOKEN`, run `npm run dev`, then open localhost:3000 and use Start Live Stream (WHEP).
- **Refresh-token mode:** set `RING_REFRESH_TOKEN`, `RING_CLIENT_ID` and `RING_CLIENT_SECRET`. This mode adds the webhook to SSE dashboard, the video processors (Catch the Logo hand-tracking game, Motion Heatmap, Brightness Analyzer) and canvas overlays.
- **Gaps and contradictions:**
  - The sample webhook uses `RING_WEBHOOK_SECRET` as a "Bearer token" and its test curl posts `{"event_type":...}`. The official spec uses an `X-Signature` HMAC and a v1.1 JSON:API payload. Implement the official scheme.
  - The README does not show snapshot, clip or chime calls.

## 8. UX Design Guide: required patterns ([ux-design-guide](https://developer.amazon.com/docs/ring/ux-design-guide.html); published 2025-04-22 per release notes, page undated)

Design checklist items used for certification readiness:

1. **Registration and linking:** emphasize **Create Account / Sign Up** over Sign In ("separate from your Ring account").
2. **Passwordless linking is recommended.** Fetch the Ring email with `/v1/users/me` after nonce matching, create the account server-side and auto-link. The guide claims near-100% completion versus 60–80% for signup forms.
   - Alternatives: pre-fill the email, skip verification when it matches the Ring email, defer verification otherwise.
   - Never block linking on email verification, and put forgot-password inline.
3. **After linking:** show a confirmation screen listing devices with online/offline status, what happens next and a dashboard link. Provide a **skippable first-visit tutorial** with progress and a way to revisit it.
4. **Configuration guidance messages** follow "what's wrong, then why it matters, then where in the Ring app to fix it." They cover Smart Alerts, motion recording, motion zones, privacy zones, color night vision and HDR. Never imply these can be changed in your app.
5. **Devices:** show **user-assigned names, never device IDs**. Show an online/offline indicator, dim offline devices rather than hiding them, use helpful empty states, and handle `device_removed` immediately.
6. **Privacy zones (MUST):** don't display, analyze or store video inside them, exclude them from overlays, and don't expose their coordinates.
7. **Subscriptions:** cover the five display states (active paid, active trial, expired trial, none, cancelled), cascading cancellation, and send users to **Ring My Apps** to manage plans.
8. **Tokens:** never display tokens or IDs, refresh silently, and re-prompt only when the refresh token has expired.
9. **Data:** provide an in-app data deletion mechanism and a privacy policy.
10. **Engagement:** daily or weekly summaries, at most **1 routine email or SMS per day**, granular notification controls, and CAN-SPAM/TCPA opt-out.
11. **Accessibility:** **WCAG 2.2 AA** (contrast, screen reader labels, keyboard navigation, reduced motion, not relying on color alone, plain language, captions).
12. **Listing:** screenshots, a setup walkthrough video, privacy and deletion policy links, support contact.

## 9. Ring Appstore landscape (rivals and precedents)

There are **56 apps** in [ring.com/appstore/category/all-apps](https://ring.com/appstore/category/all-apps) as of 2026-10-03. Firecrawl reached the page even though the docs say it is US-only. Store categories are Home, Business, Indoor, Outdoor, AI analytics, Security and Access Control, and Workflow automations. Grouped by the hackathon's priority categories (my grouping, from listing blurbs):

- **Caretaking:**
  - Beside Care ($19.99/mo per device): AI caregiver digests from motion events, no video stored ([listing](https://ring.com/appstore/beside-care)).
  - Remy: Elder Care, Fall Alerts ($19), Senior Fall Detection ($55), VitalWatch ($99), FallGuard ($9.99), Routines ($10, "AI care coordinator for your family group chat"), MySentry ($4.99, emergency response with Ring camera access).
- **Access control / short-term rentals:**
  - Seam ($5): connects 30+ smart-lock, thermostat and access brands itself. On the Ring side it uses only webhooks, clips, snapshots and status ([listing](https://ring.com/appstore/seam)).
  - Minut, Sojur, Eclipso, GuardCat, Occupancy Guard, ZoneGauge.
- **Package / delivery:** PackageProtect (AllScout), Porchify, Mailbox Alert.
- **Business systems:** CounterClock, DriveThru Stats, StoreTraffic, Lumeo, QueueFlow Sentinel, Open & Close Monitor, Business Protect, Cam Uptime Fleet, ProofClock, DumpWatch, TimeStack. Ring Cheer Chime is a free, **Ring-owned** app that plays a chime tone when a POS tip arrives (Toast/Square) ([listing](https://ring.com/appstore/ring-cheer-chime)).
- **Home automation / other:** Garage Check, TimeLapse, Daily Frame, DailyLens, Greenlapse, MomentReel, Video Wall Live (TV), Video Watch Live (Apple Watch), Seeva Online, Cam Uptime Alerts, PoolAgent, School Bus Home.
- **AI analytics:** Driveway Alert, Visionify, Memories.ai, Vitecso, Is Your Room Clean, Pet Vet AI, BarkGuard.
- **Wildlife:** What's That Bird.AI, YardWild, Wildlife Alert, Dangerous Animal Alert, Home Field Coyote Cam.
- **Biometric precedent:** StrangerAlert ($3.99) runs its own "Familiar Faces / Watchlist" system, discloses "Biometric data", and is unavailable in IL and TX ([listing](https://ring.com/appstore/strangeralert)).
- **Accessibility:** no listing positioned mainly as an accessibility aid was found in the 56 blurbs (my inference). A hackathon rival video, **Describe My Door**, targets blind residents with a webhook, snapshot, vision model, spoken description and chime tone, built on Strands Agents ([YouTube](https://m.youtube.com/watch?v=0lSdXD05W7o), 3 views, uploaded 2026-09-16).
- **Pricing pattern:** monthly per-device subscriptions from $1 to $99 with free trials. All prices are vendor listings (stated offer, not measured traction).

## 10. Ring developer community ([c/ring/53](https://community.amazondeveloper.com/c/ring/53))

- **Activity:** traffic is low, with 13–278 views per topic and 0–8 replies.
- **Recent topics:**
  - "Contact Sensor scope enabled on private app, sensor not offered at account linking" (4 days ago, 2 replies, body not read).
  - "Subscription / Billing" (23 days ago).
  - Hackathon announcement (2026-08-31, 151 views; only general content).
  - "Free trials now convert to paid subscriptions automatically" (2026-08-13).
  - "Issue testing staging app with motion events" (2026-07-10 to 07-13). Ring staff answer: Smart Alerts, motion recording, zones, Ring Protection plan, online status.
  - "Unable to add test users to Ring Staging" (a portal 406 error; reported 2026-06-01, confirmed fixed by the reporter on 2026-06-09).
  - "Obtaining a camera snapshot" (2026-05-22 to 05-26). Covers `TIME_RANGE_NOT_AUTHORIZED` and the advice to use the webhook timestamp; Ring staff also mention a ±10 s tolerance for `at_timestamp`.
- **No hackathon-specific simulator or Playground Q&A** was found in the topic listing.
- The "Aug 31, 2026: Hackathon & Ring Updates" newsletter covers TAKE, weekly metrics reports, dynamic scopes and sensors ([post](https://community.amazondeveloper.com/t/aug-31-2026-hackathon-ring-updates/29048)).

## 11. Hackathon framing for Ring ([rules](https://amazonappdev2026.devpost.com/rules))

- **Requirement:** "A working app or new feature that utilizes Ring APIs, SDKs, simulators, or devices, demonstrated through a simulator or an actual device."
- **Priority categories:** access control, business systems, IoT home automation, accessibility, caretaking.
- **Judging guidance, "Obvious":** a motion alert or basic live view.
- **Judging guidance, "Creative":** non-security use cases (accessibility aid, caretaking monitoring, package/delivery management), business system integration (commercial access control), a multi-camera pipeline, or event-based triggers.
- **Repo:** must call Ring tech at runtime.
- **Prizes:** Ring 1st place is $12,000.

---

## Gaps / unverified / contradictions

1. **Playground internals were not inspected because of the login wall.** Unverified:
   - whether it exposes real or synthetic devices;
   - whether simulated events reach your **webhook URL** or only the in-console live view;
   - whether snapshots and clips work;
   - whether it is region-gated;
   - whether developer identity verification is needed to open it.
   The release notes (Package/Vehicle/Motion simulation with WHEP) conflict with the third-party claim that the "Ring sandbox can't deliver events or footage."
2. **The "Sandbox Environment"** (synthetic devices, no rate limits) appears only in the get-started glossary and FAQ. No page describes how to access it, and it may be the Playground.
3. **Region:** US-only testing devices and Appstore reachability conflict with "Private apps available to Ring accounts from any country." Whether an India-based developer can create a Ring account or a Ring Protection trial is not verified.
4. **Private app account cap:** 5 per the 2026-07-21 release note, 10 per publish.html and FAQ Q16.
5. **Webhook types:** develop.html says "three webhook types," while the API reference lists 10 core types plus sensor types. develop.html looks stale.
6. **GA date:** the release notes show "April 21, 2025" as GA, while the community "Launch Announcement: Ring Developer Portal — General Availability" is dated Mar 31 (the year is not shown in the listing; community posts start Dec 2025 to Feb 2026). The release-notes year may be a typo. Not resolved.
7. **Webhook idempotency:** the docs do not say whether retried deliveries reuse `meta.request_id`. Deduping on both `request_id` and `data.id` is a safer design (my inference).
8. **Ordering guarantees:** not documented, and out-of-order delivery is acknowledged for subscription webhooks.
9. **Snapshot scope:** which dynamic scope authorizes image download is not stated.
10. **Chime slot audio provisioning:** "Guidance … is published separately." It was not found, so whether custom or TTS audio can be put in slots is not verified.
11. **Starter repo:** its webhook auth (Bearer secret) differs from the official HMAC `X-Signature`.
12. **TAKE rollout:** the share of devices already on TAKE is unknown. The FAQ says partner support for the most recent 24 h of TAKE video is "being worked on," and an encryption-status field is promised "soon."
13. **Motion sub-types:** webhooks list motion/human/vehicle/other_motion while event history adds animal. Whether webhooks ever send `animal` is not verified.
14. **The Devpost phrase "computer vision APIs"** has no matching inference endpoint in the docs. Treat it as marketing shorthand (M).
15. **Appstore landscape counts and prices** are a live listing snapshot. The categories here are my grouping, not Ring's taxonomy. No install or traction data is available.
16. `competitor-door-search.json` contained only Google Home / Gemini pages and is not Ring-relevant.

---

## Searches run

| Query | Saved file | Useful |
|---|---|---|
| (pre-existing) Ring competitor search | `.firecrawl/competitor-ring-search.json` | Yes (consumer features and plans) |
| (pre-existing) door/doorbell competitor search | `.firecrawl/competitor-door-search.json` | No (Google Home only) |
| `firecrawl map https://developer.amazon.com/docs/ring/` | `.firecrawl/ring-map-docs.json` | Yes (16 doc URLs) |
| `"Ring Developer Playground" OR "Ring Appstore" developer API playground` (qdr:y, --scrape) | `.firecrawl/ring-search-playground.json` | Partly (found the Describe My Door rival video) |
| `Ring app supported countries where are Ring products available India` (--scrape) | `.firecrawl/ring-search-countries.json` | Yes (country selector) |

## Sources read (bodies read; method noted)

| Source | Saved file | Method | Date on page |
|---|---|---|---|
| Ring Partner API Documentation | `.firecrawl/technical-ring-api.md` | pre-saved firecrawl scrape (read via grep/sed) | undated; content references Aug 2026 |
| Getting Started with Ring Developer Experience | `.firecrawl/technical-ring-get-started.md` | pre-saved firecrawl scrape | undated |
| ring-api-helloworld README | `.firecrawl/technical-ring-starter.md` | pre-saved firecrawl scrape | last commit 2026-07-01 |
| Ring API Development Guide (develop.html) | `.firecrawl/ring-develop.md` | firecrawl scrape (after 429 retries; MCP also 429) | undated; references Sep 2026 notes |
| Ring Appstore API Release Notes | `.firecrawl/ring-release-notes.md` | firecrawl scrape | entries 2025-04-21 to 2026-09-21 |
| Configure Phase | `.firecrawl/ring-configure.md` | firecrawl scrape | undated (updated per 2026-08-24 note) |
| Developer FAQ & Certification Best Practices | `.firecrawl/ring-developer-faq.md` | firecrawl scrape | undated (TAKE section added 2026-09-16) |
| UX Design Guide | `.firecrawl/ring-ux-design-guide.md` | firecrawl scrape | undated (published 2025-04-22 per notes) |
| Publish Your Ring Application | `.firecrawl/ring-publish.md` | firecrawl scrape | undated |
| Certify Your Ring Application | `.firecrawl/ring-certify.md` | firecrawl scrape | undated |
| Ring Appstore MCP Server | `.firecrawl/ring-mcp.md` | firecrawl scrape | undated |
| Ring Appstore Permitted Content Policy | `.firecrawl/ring-content-policy.md` | firecrawl scrape (sections read) | undated |
| Ring Developer Playground console | `.firecrawl/ring-playground.md` | firecrawl scrape: **sign-in wall only** | n/a |
| ring.com/appstore | `.firecrawl/ring-appstore.md` | firecrawl scrape | live, undated |
| ring.com/appstore/category/all-apps | `.firecrawl/ring-appstore-all-apps.md` | firecrawl scrape (parsed 56 listings) | live, undated |
| Beside Care listing | `.firecrawl/ring-appstore-beside-care.md` | firecrawl scrape | undated |
| Seam listing | `.firecrawl/ring-appstore-seam.md` | firecrawl scrape | undated |
| Ring Cheer Chime listing | `.firecrawl/ring-appstore-cheer-chime.md` | firecrawl scrape | undated |
| StrangerAlert listing | `.firecrawl/ring-appstore-strangeralert.md` | firecrawl scrape | undated |
| Ring community category listing | `.firecrawl/ring-community.md` | firecrawl scrape | topics dated |
| Community: hackathon announcement | `.firecrawl/ring-community-hackathon.md` | firecrawl scrape | 2026-08-31 |
| Community: staging motion events | `.firecrawl/ring-community-staging-motion.md` | firecrawl scrape | 2026-07-10/13 |
| Community: unable to add staging users | `.firecrawl/ring-community-staging-users-print.md` (+ `ring-community-staging-users.md`) | firecrawl scrape (print view) | 2026-06-01 to 06-10 |
| Community: obtaining a camera snapshot | `.firecrawl/ring-community-snapshot-print.md` | firecrawl scrape (print view) | 2026-05-22 to 05-26 |
| Community: Aug 31 2026 Hackathon & Ring Updates | `.firecrawl/ring-community-aug31-updates.md` | firecrawl scrape (print view) | 2026-08-31 |
| About Amazon: Ring introduces TAKE | `.firecrawl/ring-take-encryption.md` | firecrawl scrape | 2026-08-26 |
| Ring support: Intelligent features | `.firecrawl/competitor-ring-search.json` [0] | pre-saved search --scrape | "Last updated 1 month ago" |
| Ring Protect plans | `.firecrawl/competitor-ring-search.json` [1] | pre-saved search --scrape | undated |
| Ring country selector | `.firecrawl/ring-search-countries.json` [0] | search --scrape | undated |
| Describe My Door (YouTube, third-party hackathon demo) | `.firecrawl/ring-search-playground.json` [2] | search --scrape (description + transcript) | uploaded 2026-09-16 |
| Devpost FAQ / rules / updates / resources (Ring sections) | `.firecrawl/amazonappdev2026.devpost.com-details-faqs.md`, `-rules.md`, `-updates.md`, `technical-resources.md` | pre-saved firecrawl scrape (grep) | undated |
