import { ORDERS, POLICY } from "./data.js";

// ---------------------------------------------------------------------------
// 1. Order ID normalisation
// Speech-to-text turns "ORD-101" into things like "ord 101", "order one zero
// one", "one oh one", "one hundred and one". We map all of these to ORD-101.
// ---------------------------------------------------------------------------
const UNITS = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordsToDigits(tokens) {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // "one hundred (and) five" / "one hundred twenty three"
    if (t in UNITS && tokens[i + 1] === "hundred") {
      let value = UNITS[t] * 100;
      let j = i + 2;
      if (tokens[j] === "and") j++;
      if (tokens[j] in TEENS) { value += TEENS[tokens[j]]; j++; }
      else if (tokens[j] in TENS) {
        value += TENS[tokens[j]]; j++;
        if (tokens[j] in UNITS) { value += UNITS[tokens[j]]; j++; }
      } else if (tokens[j] in UNITS) { value += UNITS[tokens[j]]; j++; }
      out += String(value);
      i = j - 1;
    } else if (t in UNITS) {
      out += String(UNITS[t]);
    } else if (t in TEENS) {
      out += String(TEENS[t]);
    } else if (t in TENS) {
      if (tokens[i + 1] in UNITS && tokens[i + 1] !== "o" && tokens[i + 1] !== "oh" && tokens[i + 1] !== "zero") {
        out += String(TENS[t] + UNITS[tokens[i + 1]]);
        i++;
      } else {
        out += String(TENS[t]);
      }
    }
  }
  return out;
}

export function normalizeOrderId(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;

  // Case 1: the string already has digits -> join all digit groups ("ord 1 0 1" -> 101)
  const digitGroups = s.match(/\d+/g);
  if (digitGroups) return `ORD-${digitGroups.join("")}`;

  // Case 2: spelled-out numbers
  // Remove the spoken "O R D" / "order" prefix so the letter "o" isn't read as zero.
  const cleaned = s.replace(/\bo\s*r\s*d\b/g, " ").replace(/\b(ord|order|number|id|no)\b/g, " ");
  const tokens = cleaned.split(/[^a-z]+/).filter(Boolean);
  const digits = wordsToDigits(tokens).replace(/^0+(?=\d)/, "");
  return digits ? `ORD-${digits}` : null;
}

// ---------------------------------------------------------------------------
// 2. Policy eligibility is computed HERE, in code. The LLM only reads the
//    result, so it cannot "decide" to give a refund the policy doesn't allow.
// ---------------------------------------------------------------------------
function eligibility(order) {
  const isProcessing = order.status === "Processing";
  const delivered = order.status === "Delivered";
  const days = order.delivered_days_ago;
  return {
    can_cancel: isProcessing,
    cancel_note: isProcessing
      ? "Order is Processing, so it can be cancelled."
      : delivered
        ? "Order is already delivered, so it cannot be cancelled. A return may apply instead, subject to the return policy."
        : `Order is ${order.status}, so it cannot be cancelled. The customer may refuse delivery at the doorstep.`,
    return_window_open: delivered && days !== null && days <= POLICY.returnWindowDays,
    damage_report_window_open: delivered && days !== null && days * 24 <= POLICY.damageReportHours,
    days_since_delivery: delivered ? days : null,
    cod_eligible: order.value <= POLICY.codLimit,
    free_shipping: order.value > POLICY.freeShippingThreshold,
  };
}

function lookup(rawId) {
  const id = normalizeOrderId(rawId);
  if (!id) return { error: { found: false, reason: "missing_order_id", message: "No order ID was provided. Ask the customer for their order ID (format ORD-101)." } };
  const order = ORDERS[id];
  if (!order) return { error: { found: false, reason: "order_not_found", searched_for: id, message: `No order exists with ID ${id}. Do not invent details. Ask the customer to repeat or verify the ID.` } };
  return { id, order };
}

// ---------------------------------------------------------------------------
// 3. Tool implementations
// ---------------------------------------------------------------------------
export function get_order_details({ order_id }) {
  const { error, order } = lookup(order_id);
  if (error) return error;
  return { found: true, ...order, eligibility: eligibility(order) };
}

export function check_return_eligibility({ order_id, is_opened, issue_type }) {
  const { error, order } = lookup(order_id);
  if (error) return error;
  const e = eligibility(order);

  if (order.status !== "Delivered") {
    return { order_id: order.order_id, eligible: false, reason: `Order is ${order.status}, not delivered yet, so a return is not possible. ${e.cancel_note}` };
  }
  if (issue_type === "damaged" || issue_type === "defective") {
    return e.damage_report_window_open
      ? { order_id: order.order_id, eligible: true, action: "replacement", reason: "Within 48 hours of delivery. Customer must share photos of the damage for a replacement." }
      : { order_id: order.order_id, eligible: false, reason: `Damaged or defective products must be reported within 48 hours of delivery. This order was delivered ${order.delivered_days_ago} days ago.` };
  }
  if (!e.return_window_open) {
    return { order_id: order.order_id, eligible: false, reason: `Returns are accepted within 7 days of delivery. This order was delivered ${order.delivered_days_ago} days ago, so it is outside the return window.` };
  }
  if (is_opened === true) {
    return { order_id: order.order_id, eligible: false, reason: "Only unopened, unused products in original packaging can be returned." };
  }
  if (is_opened === undefined || is_opened === null) {
    return { order_id: order.order_id, eligible: "unknown", reason: "Within the 7 day window. Ask the customer whether the product is unopened and unused before confirming." };
  }
  return { order_id: order.order_id, eligible: true, action: "return", reason: "Within 7 days and unopened, so the return is accepted." };
}

export function cancel_order({ order_id }) {
  const { error, order } = lookup(order_id);
  if (error) return error;
  if (order.status !== "Processing") {
    return { order_id: order.order_id, cancelled: false, reason: eligibility(order).cancel_note };
  }
  return {
    order_id: order.order_id,
    cancelled: true,
    confirmation_id: `CXL-${order.order_id.slice(4)}-${Date.now().toString().slice(-4)}`,
    message: "Cancellation request placed successfully (mock).",
  };
}

export function escalate_to_human({ reason, order_id }) {
  return {
    escalated: true,
    ticket_id: `AURA-${Date.now().toString().slice(-6)}`,
    reason,
    order_id: order_id ? normalizeOrderId(order_id) : null,
    message: "A ticket has been created for the human support team, who will follow up with the customer.",
  };
}

export function end_call() {
  return { ok: true, message: "Say a short, warm goodbye. The call will end after you speak." };
}

export const TOOL_IMPLEMENTATIONS = {
  get_order_details,
  check_return_eligibility,
  cancel_order,
  escalate_to_human,
  end_call,
};

// ---------------------------------------------------------------------------
// 4. JSON schemas sent to the LLM (OpenAI-compatible format, used by Groq)
//    The descriptions are what the model reads to decide WHEN to call a tool.
// ---------------------------------------------------------------------------
export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "Look up a customer's order: status, product, value, courier, tracking and policy eligibility flags. Call this BEFORE saying anything about a specific order (tracking, delivery, cancellation, return).",
      parameters: {
        type: "object",
        properties: { order_id: { type: "string", description: "Order ID as said by the customer, e.g. ORD-101. Pass exactly what you heard; the system normalises it." } },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_return_eligibility",
      description: "Check whether a delivered order can be returned or replaced under Aura's policy. Use when the customer wants a return, refund or replacement.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          is_opened: { type: "boolean", description: "Whether the customer says the product has been opened or used. Omit if not known yet." },
          issue_type: { type: "string", enum: ["change_of_mind", "damaged", "defective", "other"] },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_order",
      description: "Cancel an order. Only call after the customer has clearly confirmed they want to cancel. The system rejects it if the order is not Processing.",
      parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description: "Create a ticket for the human support team when you cannot resolve the issue, the customer insists on something outside policy, or asks for a human.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" }, order_id: { type: "string" } },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_call",
            description: "End the call. ONLY call this when the customer explicitly says goodbye or that they need nothing else. Never call it after declining a request or answering a question.",
      parameters: { type: "object", properties: {} },
    },
  },
];