/**
 * Testes Zedy via HTTP (servidor local) + smoke de mapeamento.
 * Uso: node --import tsx scripts/test-zedy-http.mjs   (ou rode com o bloco abaixo)
 */
const BASE = process.env.ZEDY_TEST_BASE || "http://127.0.0.1:8080";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("=== Testes HTTP Zedy @", BASE, "===");

  // 1) Webhook sem token → 503 (token ainda não cadastrado) ou 401
  {
    const res = await fetch(`${BASE}/api/public/zedy-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "t1", eventType: "ORDER_PAID", status: "paid" }),
    });
    assert(res.status === 401 || res.status === 503, `esperado 401/503, veio ${res.status}`);
    console.log(`✓ webhook não autorizado/sem config → ${res.status}`);
  }

  // 2) Webhook Bearer inválido
  {
    const res = await fetch(`${BASE}/api/public/zedy-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-invalido",
      },
      body: JSON.stringify({ orderId: "t2", eventType: "ORDER_PAID", status: "paid" }),
    });
    assert(res.status === 401 || res.status === 503, `esperado 401/503, veio ${res.status}`);
    console.log(`✓ webhook Bearer inválido → ${res.status}`);
  }

  // 3) Checkout com carrinho vazio
  {
    const res = await fetch(`${BASE}/api/loja/v1/cart/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    assert(res.status === 400 || res.status === 422, `carrinho vazio deveria falhar, veio ${res.status}`);
    console.log(`✓ checkout carrinho vazio → ${res.status}`);
  }

  // 4) Checkout com produto inexistente
  {
    const res = await fetch(`${BASE}/api/loja/v1/cart/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: 999999999, qty: 1, size: "42" }] }),
    });
    const json = await res.json();
    assert(json.ok === false, "produto inexistente deveria ok:false");
    console.log(`✓ checkout produto não encontrado → ${res.status}`, json.error || "");
  }

  // 5) Qty inválida
  {
    const res = await fetch(`${BASE}/api/loja/v1/cart/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: 1, qty: 0 }] }),
    });
    assert(res.status === 400 || res.status === 422, `qty 0 deveria falhar, veio ${res.status}`);
    console.log(`✓ checkout qty inválida → ${res.status}`);
  }

  console.log("=== HTTP OK ===");
  console.log(
    "Nota: checkout real + match de catálogo exigem ZEDY_API_TOKEN e ZEDY_STORE_ID cadastrados.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
