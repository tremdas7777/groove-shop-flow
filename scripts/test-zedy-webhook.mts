process.env.ZEDY_WEBHOOK_TOKEN = "test_webhook_secret";

const { handleZedyWebhook } = await import("../src/lib/zedy-server");

const bad = await handleZedyWebhook(
  new Request("http://x/api/public/zedy-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer wrong",
    },
    body: JSON.stringify({ orderId: "o1", eventType: "ORDER_PAID", status: "paid" }),
  }),
);
if (bad.status !== 401) throw new Error(`unauthorized expected 401 got ${bad.status}`);
console.log("✓ webhook não autorizado → 401");

const orderId = `ord_test_${Date.now()}`;
const good = await handleZedyWebhook(
  new Request("http://x/api/public/zedy-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test_webhook_secret",
    },
    body: JSON.stringify({
      orderId,
      eventType: "CART_ABANDONED",
      status: "waiting_payment",
      customer: { name: "Cliente Teste" },
    }),
  }),
);
if (good.status !== 200) throw new Error(`authorized expected 200 got ${good.status}`);
console.log("✓ webhook autorizado → 200");

const again = await handleZedyWebhook(
  new Request("http://x/api/public/zedy-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test_webhook_secret",
    },
    body: JSON.stringify({
      orderId,
      eventType: "CART_ABANDONED",
      status: "waiting_payment",
    }),
  }),
);
const againJson = await again.json();
if (!againJson.ok || !againJson.deduped) {
  throw new Error(`idempotência falhou ${JSON.stringify(againJson)}`);
}
console.log("✓ webhook idempotente → deduped");
