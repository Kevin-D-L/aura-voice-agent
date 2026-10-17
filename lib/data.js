// Single source of truth for brand policies and the mock order database.
// Both the system prompt and the tools import from this file.

export const BRAND = {
  name: "Aura Skincare",
  overview:
    "Aura Skincare is a premium organic Indian skincare brand focused on simple, effective skincare products made with thoughtfully selected ingredients.",
};

export const POLICY = {
  freeShippingThreshold: 499, // free delivery on orders ABOVE this
  shippingFee: 50,
  deliveryDays: "3 to 5 business days",
  returnWindowDays: 7,
  damageReportHours: 48,
  codLimit: 2500,
};

export const POLICY_TEXT = `
SHIPPING: Free delivery on orders above ₹499. Orders below ₹499 have a ₹50 shipping fee. Standard delivery takes 3 to 5 business days.
RETURNS & REFUNDS: Returns are accepted within 7 days of delivery for unopened, unused products in original packaging. Damaged or defective products must be reported within 48 hours of delivery with photos, for a replacement.
CANCELLATION: Orders can be cancelled only while their status is Processing. Once an order is Shipped or Out for Delivery it cannot be cancelled (the customer may refuse delivery at the doorstep).
CASH ON DELIVERY: COD is available for orders up to ₹2,500. Customers can pay by cash or UPI at the doorstep.
`.trim();

// Mock order database. Relative times are stored as numbers so the tools can
// compute policy eligibility in code instead of trusting the LLM with dates.
export const ORDERS = {
  "ORD-101": {
    order_id: "ORD-101",
    customer_name: "Priya Sharma",
    product: "Vitamin C Serum (30ml)",
    value: 699,
    status: "Out for Delivery",
    courier: "BlueDart",
    tracking_id: "BD-982103",
    note: "Expected by 6 PM today",
    delivered_days_ago: null,
    ordered_hours_ago: null,
  },
  "ORD-102": {
    order_id: "ORD-102",
    customer_name: "Rahul Verma",
    product: "Hydrating Sunscreen SPF 50",
    value: 499,
    status: "Delivered",
    courier: "Delhivery",
    tracking_id: "DL-441029",
    note: "Delivered 14 days ago",
    delivered_days_ago: 14,
    ordered_hours_ago: null,
  },
  "ORD-103": {
    order_id: "ORD-103",
    customer_name: "Ananya Patel",
    product: "Green Tea Face Wash + Toner",
    value: 850,
    status: "Processing",
    courier: null,
    tracking_id: null,
    note: "Ordered 3 hours ago",
    delivered_days_ago: null,
    ordered_hours_ago: 3,
  },
};

export const GREETING = "Hi, this is Aria from Aura Skincare. How can I help you today?";