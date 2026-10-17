"use client";

import { useEffect, useRef, useState } from "react";
import { ORDERS, GREETING } from "@/lib/data";
import styles from "./page.module.css";

const TEST_PROMPTS = [
  "Where is my order ORD-101?",
  "I want to cancel ORD-101",
  "Please cancel ORD-103",
  "I opened my sunscreen from ORD-102, can I return it?",
  "Can you check ORD-999?",
  "Is cash on delivery available?",
  "Can you book me a flight to Goa?",
];

const STATE_LABEL = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function pickDefaultVoice(voices) {
  const isIN = (v) => v.lang?.toLowerCase().replace("_", "-") === "en-in";
  const natural = (v) => /natural|online|neural/i.test(v.name);
  const female = /neerja|heera|veena|female|swara|kajal|aria|jenny|sonia/i;
  return (
    voices.find((v) => isIN(v) && natural(v) && female.test(v.name)) || // Edge: Neerja Online (Natural)
    voices.find((v) => isIN(v) && natural(v)) ||
    voices.find((v) => isIN(v) && /google/i.test(v.name)) ||           // Chrome: Google en-IN
    voices.find((v) => v.lang?.startsWith("en") && natural(v) && female.test(v.name)) ||
    voices.find((v) => /google uk english female/i.test(v.name)) ||
    voices.find(isIN) ||
    voices.find((v) => v.lang?.startsWith("en")) ||
    voices[0] ||
    null
  );
}

export default function Home() {
  // ---------------- UI state ----------------
  const [supported, setSupported] = useState(true);
  const [callStatus, setCallStatus] = useState("idle"); // idle | active | ended
  const [agentState, setAgentState] = useState("idle"); // idle | listening | thinking | speaking
  const [transcript, setTranscript] = useState([]);
  const [interim, setInterim] = useState("");
  const [toolLog, setToolLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const [bargeIn, setBargeIn] = useState(false);
  const [lang, setLang] = useState("en-IN");
  const [copied, setCopied] = useState(false);

  // ---------------- refs (used inside speech callbacks) ----------------
  const recRef = useRef(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const recognizingRef = useRef(false);
  const historyRef = useRef([]); // messages sent to the LLM
  const transcriptRef = useRef([]); // what the UI / summary uses
  const toolEventsRef = useRef([]);
  const silenceRef = useRef(0);
  const silencePromptsRef = useRef(0);
  const turnRef = useRef(0);
  const currentSpeechRef = useRef(""); // what Aria is saying right now (for echo filtering)
  const speechEndedAtRef = useRef(0);
  const voiceRef = useRef(null);
  const bargeInRef = useRef(false);
  const langRef = useRef("en-IN");
  const transcriptEndRef = useRef(null);

  useEffect(() => { bargeInRef.current = bargeIn; }, [bargeIn]);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // Feature detection + voice loading
  useEffect(() => {
    const load = () => {
      const all = window.speechSynthesis?.getVoices() || [];
      const usable = all
        .filter((v) => /^(en|hi)/i.test(v.lang))
        .sort((a, b) => (b.lang.includes("IN") ? 1 : 0) - (a.lang.includes("IN") ? 1 : 0));
      setVoices(usable);
      if (!voiceRef.current && usable.length) {
        const def = pickDefaultVoice(usable);
        voiceRef.current = def;
        setVoiceName(def?.name || "");
      }
    };
    const init = setTimeout(() => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR || !window.speechSynthesis) setSupported(false);
      load();
    }, 0);
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
    return () => {
      clearTimeout(init);
      activeRef.current = false;
      try { recRef.current?.abort(); } catch {}
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript, interim]);

  // ---------------- helpers ----------------
  function addTranscript(role, text, meta = {}) {
    const entry = { role, text, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), ...meta };
    transcriptRef.current = [...transcriptRef.current, entry];
    setTranscript(transcriptRef.current);
  }

  function stopListening() {
    try { recRef.current?.abort(); } catch {}
    recognizingRef.current = false;
  }

  function startListening() {
    if (!activeRef.current || recognizingRef.current || !recRef.current) return;
    if (!speakingRef.current) setAgentState("listening");
    try {
      recRef.current.lang = langRef.current;
      recRef.current.start();
      recognizingRef.current = true;
    } catch {
      // "already started" - safe to ignore
    }
  }

  // Text-to-speech using the browser's built-in voices (free, no API).
  function speak(text) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
       currentSpeechRef.current = text;
      if (voiceRef.current) { u.voice = voiceRef.current; u.lang = voiceRef.current.lang; }
      else u.lang = "en-IN";
      u.rate = 1;

      speakingRef.current = true;
      setAgentState("speaking");
      // Without barge-in we turn the mic off while Aria talks, so she doesn't hear herself.
      if (bargeInRef.current) startListening(); else stopListening();

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        speakingRef.current = false;
        speechEndedAtRef.current = Date.now();
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // Chrome sometimes never fires onend - don't let the call get stuck.
      const safety = setTimeout(finish, Math.max(4000, text.length * 95));
      synth.speak(u);
    });
  }
    // Echo filter: the mic also hears Aria through the speakers. If most of the words
  // "heard" are words Aria is currently saying, it's her own voice - ignore it.
  function isEcho(heard) {
    const said = currentSpeechRef.current.toLowerCase();
    if (!said) return false;
    const words = heard.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) return true;
    const hits = words.filter((w) => said.includes(w)).length;
    return hits / words.length >= 0.6;
  }

  // Manual interrupt (works without headphones): stop Aria and listen.
  function interrupt() {
    window.speechSynthesis.cancel();
  }
  async function agentSays(text, { addToHistory = true } = {}) {
    addTranscript("agent", text);
    if (addToHistory) historyRef.current.push({ role: "assistant", content: text });
    await speak(text);
  }

  // ---------------- one conversation turn ----------------
  async function handleUserText(text) {
    if (!activeRef.current) return;
    const myTurn = ++turnRef.current;
    busyRef.current = true;
    silenceRef.current = 0;
    silencePromptsRef.current = 0;
    stopListening();
    if (speakingRef.current) window.speechSynthesis.cancel(); // customer interrupted
    setInterim("");
    setAgentState("thinking");

    addTranscript("user", text);
    historyRef.current.push({ role: "user", content: text });

    let data;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyRef.current }),
      });
      data = await res.json();
    } catch {
      const reply = "Sorry, I'm having trouble connecting. Could you please say that again?";
      data = { reply, newMessages: [{ role: "assistant", content: reply }], toolEvents: [] };
    }
    if (!activeRef.current || myTurn !== turnRef.current) return;

    historyRef.current.push(...(data.newMessages || []));
    if (data.toolEvents?.length) {
      toolEventsRef.current = [...toolEventsRef.current, ...data.toolEvents];
      setToolLog(toolEventsRef.current);
    }
    addTranscript("agent", data.reply, { latencyMs: data.latencyMs, tools: (data.toolEvents || []).map((t) => t.name) });

    busyRef.current = false;
    await speak(data.reply);
    if (!activeRef.current || myTurn !== turnRef.current) return; // interrupted by a newer turn

    if (data.endCall) { endCall(); return; }
    setAgentState("listening");
    startListening();
  }

  async function handleSilence() {
    busyRef.current = true;
    silencePromptsRef.current += 1;
    if (silencePromptsRef.current >= 3) {
      await agentSays("I haven't heard anything for a while, so I'll end the call now. Thank you for calling Aura Skincare!");
      endCall();
      return;
    }
    await agentSays("Sorry, I can't hear you. Are you still there?");
    busyRef.current = false;
    if (activeRef.current) startListening();
  }

  // ---------------- speech recognition (free, built into Chrome/Edge) ----------------
  function createRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = langRef.current;
    rec.continuous = false; // one utterance per session -> clean turn-taking
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
     const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      const heard = (interimText + finalText).trim();
      const recentlySpoke = speakingRef.current || Date.now() - speechEndedAtRef.current < 1500;
      // Barge-in: ignore Aria's own echo; if it's really the customer, stop her.
      if (recentlySpoke && isEcho(heard)) return;
      if (speakingRef.current) {
        if (!bargeInRef.current) return;
        if (heard.split(/\s+/).length >= 2) window.speechSynthesis.cancel();
      }
      setInterim(interimText);
      if (finalText.trim()) handleUserText(finalText.trim());
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access is blocked. Allow the mic in your browser's address bar and start the call again.");
        endCall();
      } else if (e.error === "no-speech") {
        silenceRef.current += 1;
      } else if (e.error === "network") {
        setError("Speech recognition needs an internet connection (Chrome processes it online).");
      }
    };

    rec.onend = () => {
      recognizingRef.current = false;
      if (!activeRef.current || busyRef.current) return;
      if (speakingRef.current && !bargeInRef.current) return;
      if (silenceRef.current >= 2 && !speakingRef.current) {
        silenceRef.current = 0;
        handleSilence();
        return;
      }
      startListening(); // keep the mic open for the whole call
    };
    return rec;
  }

  // ---------------- call controls ----------------
  async function startCall() {
    setError("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("This browser doesn't support speech recognition. Please use Google Chrome or Microsoft Edge on a computer.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone permission was denied. Please allow microphone access and try again.");
      return;
    }

    historyRef.current = [];
    transcriptRef.current = [];
    toolEventsRef.current = [];
    silenceRef.current = 0;
    silencePromptsRef.current = 0;
    turnRef.current = 0;
    busyRef.current = false;
    setTranscript([]);
    setToolLog([]);
    setSummary(null);
    setInterim("");

    recRef.current = createRecognition();
    activeRef.current = true;
    setCallStatus("active");

    busyRef.current = true;
    await agentSays(GREETING);
    busyRef.current = false;
    if (activeRef.current) startListening();
  }

  async function endCall() {
    if (!activeRef.current) return;
    activeRef.current = false;
    busyRef.current = false;
    turnRef.current++;
    stopListening();
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setInterim("");
    setAgentState("idle");
    setCallStatus("ended");

    setSummaryLoading(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptRef.current, toolEvents: toolEventsRef.current }),
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch {
      setSummary({ error: "Could not generate summary." });
    }
    setSummaryLoading(false);
  }

  function onVoiceChange(name) {
    setVoiceName(name);
    voiceRef.current = voices.find((v) => v.name === name) || null;
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const inCall = callStatus === "active";

  // ---------------- UI ----------------
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Aura Skincare · Voice Support</h1>
          <p className={styles.sub}>Talk to Aria, our AI customer support agent. Use Chrome or Edge on desktop and allow microphone access.</p>
        </div>
      </header>

      {!supported && (
        <div className={styles.error}>Your browser doesn&apos;t support the Web Speech API. Please open this page in Google Chrome or Microsoft Edge on a computer.</div>
      )}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        {/* ---------- left: call ---------- */}
        <section className={styles.card}>
          <div className={styles.callTop}>
            <div className={`${styles.orb} ${styles[agentState]}`} aria-hidden="true" />
            <div>
              <div className={`${styles.pill} ${styles["pill_" + agentState]}`}>{inCall ? STATE_LABEL[agentState] : callStatus === "ended" ? "Call ended" : "Ready"}</div>
              <div className={styles.agentName}>Aria · Aura Skincare</div>
            </div>
          </div>

          <div className={styles.buttons}>
            <button className={styles.interrupt} onClick={interrupt} disabled={agentState !== "speaking"}>Interrupt</button>
            <button className={styles.start} onClick={startCall} disabled={inCall || !supported}>Start Call</button>
            <button className={styles.end} onClick={endCall} disabled={!inCall}>End Call</button>
          </div>

          <details className={styles.settings}>
            <summary>Settings</summary>
            <label>
              Voice
              <select value={voiceName} onChange={(e) => onVoiceChange(e.target.value)} disabled={inCall}>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </label>
            <label>
              Speech language
              <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={inCall}>
                <option value="en-IN">English (India)</option>
                <option value="hi-IN">Hindi / Hinglish</option>
              </select>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={bargeIn} onChange={(e) => setBargeIn(e.target.checked)} disabled={inCall} />
              Allow interrupting Aria (use headphones, otherwise she hears herself)
            </label>
          </details>

          <h2>Live transcript</h2>
          <div className={styles.transcript}>
            {transcript.length === 0 && !interim && <p className={styles.muted}>Press Start Call and say hello.</p>}
            {transcript.map((t, i) => (
              <div key={i} className={t.role === "user" ? styles.userMsg : styles.agentMsg}>
                <span className={styles.who}>{t.role === "user" ? "You" : "Aria"} · {t.time}</span>
                <span>{t.text}</span>
                {t.tools?.length > 0 && <span className={styles.meta}>tools: {t.tools.join(", ")}</span>}
                {t.latencyMs != null && <span className={styles.meta}>{t.latencyMs} ms</span>}
              </div>
            ))}
            {interim && <div className={`${styles.userMsg} ${styles.interim}`}>{interim}…</div>}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        {/* ---------- right: helpers ---------- */}
        <aside className={styles.side}>
          <section className={styles.card}>
            <h2>Test orders</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Order</th><th>Customer</th><th>Product</th><th>Value</th><th>Status</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {Object.values(ORDERS).map((o) => (
                    <tr key={o.order_id}>
                      <td><b>{o.order_id}</b></td>
                      <td>{o.customer_name}</td>
                      <td>{o.product}</td>
                      <td>₹{o.value}</td>
                      <td>{o.status}</td>
                      <td>{[o.courier, o.tracking_id].filter(Boolean).join(" ")}{o.courier ? ". " : ""}{o.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Try saying</h3>
            <ul className={styles.prompts}>
              {TEST_PROMPTS.map((p) => <li key={p}>&ldquo;{p}&rdquo;</li>)}
            </ul>
          </section>

          <section className={styles.card}>
            <h2>Tool calls</h2>
            {toolLog.length === 0 ? (
              <p className={styles.muted}>Tool calls made by Aria will appear here.</p>
            ) : (
              <ul className={styles.tools}>
                {toolLog.map((t, i) => (
                  <li key={i}>
                    <code>{t.name}({t.args && t.args !== "{}" ? t.args : ""})</code>
                    <pre>{JSON.stringify(t.result, null, 2)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* ---------- post-call summary ---------- */}
      {callStatus === "ended" && (
        <section className={`${styles.card} ${styles.summary}`}>
          <h2>Post-call summary</h2>
          <div className={styles.summaryGrid}>
            <div>
              <h3>Call transcript</h3>
              <ol className={styles.finalTranscript}>
                {transcript.map((t, i) => (
                  <li key={i}><b>{t.role === "user" ? "Customer" : "Aria"}</b> <span className={styles.muted}>[{t.time}]</span>: {t.text}</li>
                ))}
              </ol>
            </div>
            <div>
              <div className={styles.jsonHead}>
                <h3>Structured outcome (JSON)</h3>
                {summary && <button className={styles.copy} onClick={copySummary}>{copied ? "Copied" : "Copy"}</button>}
              </div>
              {summaryLoading ? <p className={styles.muted}>Generating summary…</p> : <pre className={styles.json}>{JSON.stringify(summary, null, 2)}</pre>}
            </div>
          </div>
        </section>
      )}

      <footer className={styles.footer}>Built with Next.js, the Web Speech API and Groq. Demo data only.</footer>
    </main>
  );
}