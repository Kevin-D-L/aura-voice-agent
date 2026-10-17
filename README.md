# Aura Skincare – AI Voice Support Agent (Aria)

A browser-based AI voice agent for the fictional D2C brand **Aura Skincare**. Click **Start Call**, speak, and Aria answers in a natural Indian English voice, looks up orders through tool calls, enforces brand policy, and produces a transcript + structured JSON summary when the call ends.

- **Live app:** [YOUR-LIVE-URL](https://aura-voice-agent-kstar2.vercel.app) — best in **Microsoft Edge** on desktop (natural "Neerja" Indian voice); Chrome also works. Allow microphone access.
- **Demo video:** YOUR-VIDEO-LINK
- **Built by:** Kevin Lalai · [LinkedIn](https://www.linkedin.com/in/kevin-lalai-97758728a)

**Total cost: ₹0** — browser speech APIs, Groq free tier, Vercel Hobby.

---

## Architecture

```
 Browser (Edge / Chrome)                               Vercel (Next.js API routes)
┌──────────────────────────────────────────┐          ┌─────────────────────────────────────┐
│ Mic → Web Speech API (STT, en-IN)        │  text    │ /api/chat                           │
│        │ final transcript (echo-filtered)│ ───────► │  system prompt (persona + policy)   │
│        ▼                                 │          │  Groq LLM with tool calling         │
│ State machine:                           │          │   ├─ get_order_details              │
│   Listening → Thinking → Speaking        │ ◄─────── │   ├─ check_return_eligibility       │
│        ▲                                 │  reply   │   ├─ cancel_order                   │
│        │                                 │          │   ├─ escalate_to_human              │
│ speechSynthesis (TTS, en-IN voice)       │          │   └─ end_call                       │
│                                          │          │  tools run in code on mock order DB │
│ End Call → transcript + tool log ────────┼────────► │ /api/summary → JSON mode +          │
│                                          │          │   schema validation → outcome JSON  │
└──────────────────────────────────────────┘          └─────────────────────────────────────┘
```

| Stage | Choice | Why |
|---|---|---|
| Speech-to-text | Browser Web Speech API (`en-IN`, optional `hi-IN`) | Free, no API key, streaming interim results, Indian English model |
| LLM + tools | Groq (`openai/gpt-oss-120b`, OpenAI-compatible API) | Free tier, very fast inference (low latency), native function calling |
| Text-to-speech | Browser `speechSynthesis`, auto-picks a natural en-IN voice | Free, no extra network hop; Edge provides neural voices |
| App + hosting | Next.js on Vercel | UI + API routes in one repo; HTTPS (required for mic access) |

Typical response latency (end of speech → reply text): **X.X to X.X s**.

## How a turn works
1. The mic listens. When the recogniser returns a **final** transcript, the UI switches to **Thinking** and POSTs the conversation history to `/api/chat`.
2. `/api/chat` sends history + system prompt + 5 tool schemas to the LLM. If the model returns `tool_calls`, the server runs them against the mock order DB, appends the results and calls the model again (max 4 rounds), then returns the reply, tool log and latency.
3. The browser speaks the reply (**Speaking**), then listens again.
4. On **End Call**, the transcript and tool log go to `/api/summary`, which returns validated JSON.

### How the agent decides to use a tool
The model reads each tool's **description** (e.g. "Call this BEFORE saying anything about a specific order") plus the prompt rule "never guess order details". When the customer mentions an order, the model emits a `get_order_details` call instead of text; my server executes it and feeds the result back.

## Guardrails (three layers)
1. **Prompt rules** — persona, Aura-only scope, no promises beyond policy, no medical advice, ask to repeat when unclear, never ask for data no tool can use (e.g. pincodes).
2. **Policy computed in code, not by the LLM** — `lib/tools.js` computes `can_cancel`, `return_window_open`, `damage_report_window_open`, `cod_eligible` from order data. `cancel_order` refuses in code if the order isn't *Processing*. The server only allows `end_call` if the customer actually said goodbye — so the model can't hang up mid-conversation.
3. **Validated inputs/outputs** — spoken IDs ("order one oh one") are normalised to `ORD-101`; unknown/missing IDs return structured errors (never invented data); the summary is validated against fixed enums; any API failure returns a polite "could you repeat that?" instead of crashing.

## Edge cases handled
Invalid / missing order ID · cancelling a shipped or delivered order · return outside 7 days · opened product · damaged product past 48 h · out-of-scope requests (stays on the call) · silence ("are you still there?", ends after repeated silence) · unclear speech · Groq rate limit (429) · mic permission denied · unsupported browser · Chrome TTS not firing its end event (safety timeout).

## Extras
- **Barge-in:** talk over Aria and she stops. An **echo filter** strips Aria's own words (picked up from the speakers) from what the mic hears, so she doesn't reply to herself. There's also an **Interrupt** button.
- **Hinglish:** switch speech language to `hi-IN` in Settings; Aria replies in Roman-script Hinglish.
- **Live tool-call panel** and **per-turn latency** in the UI.

## Project structure
```
app/page.js               UI + voice loop (STT, TTS, state machine, echo filter)
app/api/chat/route.js     LLM + tool-calling loop + end-call guard
app/api/summary/route.js  post-call structured JSON summary
lib/data.js               brand policies + mock orders (single source of truth)
lib/tools.js              tool implementations, schemas, order-ID normaliser
lib/prompt.js             Aria's system prompt
lib/groq.js               minimal Groq API client (fetch)
```

## Run locally
```bash
git clone https://github.com/Kevin-D-L/aura-voice-agent.git
cd aura-voice-agent
npm install
cp .env.example .env.local    # add your free Groq key from https://console.groq.com/keys
npm run dev                   # open http://localhost:3000 in Edge or Chrome
```

## Known limitations
- Web Speech API works in Chrome and Edge only (not Firefox). Recognition audio is processed by the browser vendor's cloud service.
- Voice quality depends on voices installed in the browser/OS — Edge's "Neerja Online (Natural)" sounds best.
- No true acoustic echo cancellation in browser speech recognition; barge-in is most reliable with headphones (the Interrupt button always works).
- Mock DB is in memory, so cancellations don't persist between calls.

---

## Tell Us How You Think

**1. Why this architecture and stack?**
I used a modular STT → LLM → TTS pipeline so every stage is visible and explainable, and kept the important logic — tools, policy checks, summary — in my own server code instead of a black-box voice platform. I also set myself a ₹0 budget: the browser's speech APIs need no keys and add no TTS network latency, and Groq's free tier gives very fast inference with native function calling, which keeps the "thinking" gap short. Next.js gives me UI + API routes in one Vercel deployment with HTTPS, which the mic requires.

**2. Hardest part and how I solved it**
Making the voice loop feel natural in the browser. Aria could hear herself through the speakers, Chrome's recogniser stops silently, and the LLM sometimes ended the call when the customer hadn't said goodbye. I built a small Listening/Thinking/Speaking state machine with refs, an echo filter that strips Aria's own words from what the mic hears (enabling barge-in), and moved the "can the call end?" decision into code. Spoken order IDs ("order one oh one") were another problem, which I solved with a normaliser in the tool layer rather than trusting the model.

**3. With one more week**
Voice quality and latency, because that's what a customer feels: stream LLM tokens sentence-by-sentence into a neural TTS, and use a streaming STT with real voice-activity detection and echo cancellation (e.g. WebRTC) so barge-in works without headphones. Then an automated eval suite of scripted conversations (policy edge cases, Hinglish, noisy audio) to catch prompt regressions.

**4. At 1,000 conversations a day**
- **Data:** real database (Postgres) and courier APIs; verify the customer (phone + order ID) before sharing order details.
- **Infra:** paid LLM capacity with retries and a fallback model, per-user rate limiting, and a server-side streaming voice stack instead of browser-dependent speech.
- **Quality:** log every call, tool call and latency; dashboards for intent mix, resolution rate and escalations; QA sampling; prompt versioning and A/B tests.
- **Operations:** real human handoff into a ticketing tool, PII redaction in logs, cost-per-call tracking.
