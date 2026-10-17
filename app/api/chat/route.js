import { groqChat, MODEL } from "@/lib/groq";
import { SYSTEM_PROMPT } from "@/lib/prompt";
import { TOOL_SCHEMAS, TOOL_IMPLEMENTATIONS } from "@/lib/tools";

const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY = 40;

function cleanHistory(messages) {
  if (!Array.isArray(messages)) return [];
  let msgs = messages
    .filter((m) => m && ["user", "assistant", "tool"].includes(m.role))
    .slice(-MAX_HISTORY);
  // Never start on an orphaned tool result / tool call (can happen after trimming).
  while (msgs.length && (msgs[0].role === "tool" || msgs[0].tool_calls)) msgs.shift();
  return msgs;
}

function runTool(name, argsJson) {
  const fn = TOOL_IMPLEMENTATIONS[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "Invalid tool arguments" };
  }
  try {
    return fn(args);
  } catch (e) {
    return { error: `Tool failed: ${e.message}` };
  }
}
  // Guardrail in code: the model may only end the call after the customer says goodbye.
const BYE_WORDS = /\b(bye|goodbye|good bye|that'?s all|thats all|nothing else|no thanks|no thank you|that'?s it|end the call|hang up|dhanyavaad|shukriya|alvida)\b/i;

function customerSaidBye(history) {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  return !!lastUser && BYE_WORDS.test(lastUser.content || "");
}

export async function POST(request) {
  const started = Date.now();
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = cleanHistory(body.messages);
  const newMessages = []; // everything produced this turn (assistant + tool msgs)
  const toolEvents = [];
  let endCall = false;

  const extra = MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {};

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const data = await groqChat({
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history, ...newMessages],
        tools: TOOL_SCHEMAS,
        tool_choice: round === MAX_TOOL_ROUNDS ? "none" : "auto",
        temperature: 0.3,
        max_completion_tokens: 400,
        ...extra,
      });

      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("Empty response from model");

      if (msg.tool_calls?.length) {
        newMessages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
                   let result;
          if (call.function.name === "end_call" && !customerSaidBye(history)) {
            result = { ok: false, message: "The customer has NOT said goodbye. Do not end the call. Answer them or ask if there is anything else you can help with." };
          } else {
            result = runTool(call.function.name, call.function.arguments);
            if (call.function.name === "end_call") endCall = true;
          }
          toolEvents.push({ name: call.function.name, args: call.function.arguments, result });
          newMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue; // let the model read the tool results and answer
      }

      const reply = (msg.content || "").trim() || "Sorry, could you please repeat that?";
      newMessages.push({ role: "assistant", content: reply });
      return Response.json({ reply, newMessages, toolEvents, endCall, latencyMs: Date.now() - started });
    }
    throw new Error("Too many tool rounds");
  } catch (e) {
    console.error("[chat]", e);
    // Graceful degradation: never crash the call, ask the customer to repeat.
    const reply = e.status === 429
      ? "Sorry, I'm getting a lot of requests right now. Could you please say that again in a moment?"
      : "Sorry, I didn't quite catch that. Could you please repeat?";
    return Response.json({
      reply,
      newMessages: [{ role: "assistant", content: reply }],
      toolEvents,
      endCall: false,
      error: true,
      latencyMs: Date.now() - started,
    });
  }
}