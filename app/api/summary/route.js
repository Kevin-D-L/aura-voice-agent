import { groqChat, MODEL } from "@/lib/groq";

const INTENTS = ["ORDER_TRACKING", "CANCELLATION", "RETURN_REFUND", "DAMAGED_PRODUCT", "POLICY_QUERY", "PAYMENT_COD", "OUT_OF_SCOPE", "ESCALATION", "OTHER"];
const STATUSES = ["RESOLVED", "UNRESOLVED", "POLICY_DENIED", "ESCALATED", "NO_INTERACTION"];
const SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE"];

const SUMMARY_PROMPT = `You analyse customer support call transcripts for Aura Skincare.
Return ONLY a JSON object with exactly these keys:
{
  "customer_intent": one of ${JSON.stringify(INTENTS)} (the main intent),
  "secondary_intents": array of other intents from the same list (can be empty),
  "order_id": "ORD-xxx" or null,
  "resolution_status": one of ${JSON.stringify(STATUSES)},
  "policy_applied": short string naming the policy applied, or null,
  "tools_used": array of tool names used,
  "customer_sentiment": one of ${JSON.stringify(SENTIMENTS)},
  "call_summary": 1-3 sentence factual summary of what was asked and what the agent answered,
  "follow_up_actions": array of short strings (can be empty)
}
resolution_status meanings:
- RESOLVED: the customer's question was answered or their request was completed.
- POLICY_DENIED: the customer's request (cancel, return, refund) was refused because of a policy.
- ESCALATED: the issue was handed to the human team.
- UNRESOLVED: the issue was left open or the agent couldn't help.
- NO_INTERACTION: the customer said nothing.
Use only facts from the transcript and tool log. Do not invent anything.`;

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function validate(raw, toolEvents) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    customer_intent: pick(s.customer_intent, INTENTS, "OTHER"),
    secondary_intents: Array.isArray(s.secondary_intents) ? s.secondary_intents.filter((i) => INTENTS.includes(i)) : [],
    order_id: typeof s.order_id === "string" && /^ORD-\d+$/.test(s.order_id) ? s.order_id : null,
    resolution_status: pick(s.resolution_status, STATUSES, "UNRESOLVED"),
    policy_applied: typeof s.policy_applied === "string" ? s.policy_applied : null,
    tools_used: [...new Set(toolEvents.map((t) => t.name))],
    customer_sentiment: pick(s.customer_sentiment, SENTIMENTS, "NEUTRAL"),
    call_summary: typeof s.call_summary === "string" ? s.call_summary : "Summary unavailable.",
    follow_up_actions: Array.isArray(s.follow_up_actions) ? s.follow_up_actions.map(String) : [],
  };
}

export async function POST(request) {
  const { transcript = [], toolEvents = [] } = await request.json().catch(() => ({}));

  const customerTurns = transcript.filter((t) => t.role === "user");
  if (customerTurns.length === 0) {
    return Response.json({
      summary: validate({
        customer_intent: "OTHER",
        resolution_status: "NO_INTERACTION",
        call_summary: "The call ended before the customer said anything.",
      }, toolEvents),
    });
  }

  const transcriptText = transcript
    .map((t) => `${t.role === "user" ? "Customer" : "Aria"}: ${t.text}`)
    .join("\n");
  const toolText = toolEvents
    .map((t) => `${t.name}(${t.args}) -> ${JSON.stringify(t.result)}`)
    .join("\n") || "none";

  const extra = MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {};

  // Try twice: if the first output is not valid JSON, retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await groqChat({
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: `TRANSCRIPT:\n${transcriptText}\n\nTOOL LOG:\n${toolText}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_completion_tokens: 800,
        ...extra,
      });
      const parsed = JSON.parse(data.choices[0].message.content);
      return Response.json({ summary: validate(parsed, toolEvents) });
    } catch (e) {
      console.error("[summary] attempt", attempt, e.message);
    }
  }

  return Response.json({
    summary: validate({ call_summary: "Automatic summary failed. See transcript." }, toolEvents),
    error: true,
  });
}