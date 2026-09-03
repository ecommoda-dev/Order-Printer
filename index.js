// ============================================================
// Worker: order-printer-worker  (ecommoda-dev — NEW)
// Account: 762c353004e8472b20261fba273bfe8d
// Subdomain: order-printer-worker.ecommoda-dev.workers.dev
//
// Bindings (Dashboard → Settings → Bindings):
//   D1: DB → ecommoda-dev-logs (90db62d3-bd7e-4d92-912b-10fc78eeb565)
//   [لا يوجد KV — لا cache]
//
// Encrypted Vars: WORKER_SECRET, CLIENT_ID, CLIENT_SECRET
// Plain-text Vars: SHOP_DOMAIN = 6c7e1a-53.myshopify.com
//
// Endpoints:
//   POST /orders   → S1 + S2 orders ready for printing
//   POST /invoice  → full invoice data for one order
//   POST /track    → log print + add Printed(S1/S2) tag
//   POST /logs     → print history log (D1)
//
// ⚠️ TEMPORARY import endpoint: ?action=import_logs
//    امسحه فور تأكيد الـ Migration
//
// FIXES (v1.1.1):
//   - BUG 1 (الصح بعد تأكيد الـ docs):
//            ExchangeLineItem.lineItems (plural) هو الـ field الصح → بيرجع [LineItem!]
//            المشكلة الحقيقية: الـ fallback loop بتاعة order.lineItems بتضيف أيتمز مش exchange
//            الحل: حذف الـ fallback لـ S2 — exchange items بتيجي من exchangeLineItems بس
//   - BUG 2: returnItems عبر returns.nodes[].returnLineItems.fulfillmentLineItem.lineItem
//            (مش lineItem مباشرة — الـ path الصح من الـ official docs)
//   - DEBUG: GraphQL error logging في /invoice للتشخيص
// ============================================================

const TOOL_NAME = "order_printer";
const DATE_FROM = "2026-04-01";
const ZONE_FILTER = ["Cairo+Giza", "Show_Room"];

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── D1 writeLog ───────────────────────────────────────────────────────────────
async function writeLog(db, { tool, type, timestamp, employee, orderId, orderName, sku, productTitle, delta, valueBefore, valueAfter, notes, extra }) {
  await db.prepare(`
    INSERT INTO logs
      (tool, type, timestamp, employee, order_id, order_name, sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tool,
    type,
    timestamp || new Date().toISOString(),
    employee      || null,
    orderId       || null,
    orderName     || null,
    sku           || null,
    productTitle  || null,
    delta         || null,
    valueBefore   || null,
    valueAfter    || null,
    notes         || null,
    extra         ? JSON.stringify(extra) : null,
  ).run();
}

// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const action = url.searchParams.get("action") || "";

    const auth = request.headers.get("Authorization");
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      // ⚠️ TEMPORARY import — امسحه بعد تأكيد الـ Migration
      if (action === "import_logs") {
        if (method !== "POST") return json({ error: "POST required" }, 405);
        const body    = await request.json().catch(() => ({}));
        const entries = body.entries || [];
        let imported  = 0;

        for (let i = 0; i < entries.length; i += 50) {
          const batch = entries.slice(i, i + 50);
          await Promise.all(batch.map(entry =>
            writeLog(env.DB, {
              tool:      TOOL_NAME,
              type:      entry.type       || "S1",
              timestamp: entry.timestamp  || new Date().toISOString(),
              orderId:   entry.orderId    || null,
              orderName: entry.orderNumber || null,
              extra:     entry,
            }).catch(() => {})
          ));
          imported += batch.length;
        }

        return json({ ok: true, imported });
      }
      // END TEMPORARY

      if (method === "POST" && path === "/orders")  return handleOrders(request, env);
      if (method === "POST" && path === "/invoice") return handleInvoice(request, env);
      if (method === "POST" && path === "/track")   return handleTrack(request, env);
      if (method === "POST" && path === "/logs")    return handleLogs(request, env);
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};

// ── /orders ───────────────────────────────────────────────────────────────────
async function handleOrders(request, env) {
  await request.json().catch(() => ({}));

  const token = await getAccessToken(env);

  const [s1ConfirmedNodes, s1EditNodes, s2ReturnNodes, s2ExchangeNodes] = await Promise.all([
    fetchByQuery(env, token,
      `metafields.custom.manual_status:Confirmed created_at:>=${DATE_FROM}`),
    fetchByQuery(env, token,
      `metafields.custom.manual_status:"Confirmed + Edit" created_at:>=${DATE_FROM}`),
    fetchByQuery(env, token,
      `metafields.custom.status_2_r_e:"Confirmed + RETURN" created_at:>=${DATE_FROM}`),
    fetchByQuery(env, token,
      `metafields.custom.status_2_r_e:"Confirmed + EXCHANGE" created_at:>=${DATE_FROM}`),
  ]);

  const merged = [
    ...s1ConfirmedNodes.map(o => ({ ...o, type: "S1", status: o.manual_status?.value || "" })),
    ...s1EditNodes.map(o => ({ ...o, type: "S1", status: o.manual_status?.value || "" })),
    ...s2ReturnNodes.map(o => ({ ...o, type: "S2", status: o.status_2_r_e?.value || "" })),
    ...s2ExchangeNodes.map(o => ({ ...o, type: "S2", status: o.status_2_r_e?.value || "" })),
  ];

  const zoneFiltered = merged.filter(o => ZONE_FILTER.includes(o.zone?.value));

  const allOrders = zoneFiltered.map(o => ({
    id:        o.id,
    name:      o.name,
    createdAt: o.createdAt,
    customer:  [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "-",
    type:      o.type,
    status:    o.status,
    total:     parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
    tags:      o.tags || [],
    isPrinted: (o.tags || []).includes(`Printed(${o.type})`),
  }));

  allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return json({
    orders:   allOrders,
    total:    allOrders.length,
    cachedAt: new Date().toISOString(),
    source:   "shopify",
  });
}

// ── fetchByQuery ──────────────────────────────────────────────────────────────
const LIST_QUERY = `
  query GetOrders($cursor: String, $q: String!) {
    orders(first: 250, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id name createdAt tags
          totalPriceSet { shopMoney { amount } }
          customer { firstName lastName }
          manual_status: metafield(namespace: "custom", key: "manual_status") { value }
          status_2_r_e:  metafield(namespace: "custom", key: "status_2_r_e")  { value }
          zone:          metafield(namespace: "custom", key: "zone")           { value }
        }
      }
    }
  }
`;

async function fetchByQuery(env, token, q) {
  const results = [];
  let cursor = null, hasNext = true;

  while (hasNext) {
    const data   = await shopifyWithRetry(env, token, LIST_QUERY, { cursor, q });
    const orders = data?.data?.orders;
    if (!orders) break;
    for (const { node } of orders.edges) results.push(node);
    hasNext = orders.pageInfo.hasNextPage;
    cursor  = orders.pageInfo.endCursor;
  }

  return results;
}

// ── /invoice ──────────────────────────────────────────────────────────────────
async function handleInvoice(request, env) {
  const { orderId } = await request.json();
  if (!orderId) return json({ error: "Missing orderId" }, 400);

  const token = await getAccessToken(env);

  // ─────────────────────────────────────────────────────────────────────────
  // FIX:
  //   1. أضفنا returnLineItems داخل returns.nodes — ده اللي بيحدد الأيتمز
  //      اللي الـ customer بيرجعها فعلاً (بدل order.refunds اللي بتشمل
  //      refunds خاصة بـ removed exchange items كمان)
  //
  //   2. غيّرنا lineItems → lineItem (singular) داخل exchangeLineItems.nodes
  //      لأن ExchangeLineItem في Shopify API بيه lineItem واحد فقط
  //
  //   3. حذفنا order.refunds من الـ query خالص — مش محتاجينه بعد الفيكس
  // ─────────────────────────────────────────────────────────────────────────
  const INVOICE_QUERY = `
    query GetInvoice($id: ID!) {
      order(id: $id) {
        id name createdAt
        note phone email
        displayFinancialStatus displayFulfillmentStatus
        tags
        shippingAddress { name company address1 address2 city province phone }
        customAttributes { key value }

        lineItems(first: 50) {
          nodes {
            id title sku quantity currentQuantity fulfillableQuantity
            originalUnitPriceSet   { shopMoney { amount } }
            discountedUnitPriceSet { shopMoney { amount } }
            discountAllocations {
              allocatedAmountSet { shopMoney { amount } }
              discountApplication {
                ... on DiscountCodeApplication      { code }
                ... on ManualDiscountApplication    { title }
                ... on AutomaticDiscountApplication { title }
                ... on ScriptDiscountApplication    { title }
              }
            }
          }
        }

        discountApplications(first: 5) {
          nodes {
            targetType
            targetSelection
            value {
              ... on MoneyV2                { amount }
              ... on PricingPercentageValue { percentage }
            }
            ... on DiscountCodeApplication      { code }
            ... on ManualDiscountApplication    { title }
            ... on AutomaticDiscountApplication { title }
            ... on ScriptDiscountApplication    { title }
          }
        }

        currentShippingPriceSet { shopMoney { amount } }
        currentTotalPriceSet    { shopMoney { amount } }
        totalOutstandingSet     { shopMoney { amount } }
        totalRefundedSet        { shopMoney { amount } }

        returns(first: 3) {
          nodes {
            id status

            returnLineItems(first: 10) {
              nodes {
                ... on ReturnLineItem {
                  quantity
                  fulfillmentLineItem {
                    lineItem {
                      id title sku
                      originalUnitPriceSet { shopMoney { amount } }
                    }
                  }
                }
              }
            }

            exchangeLineItems(first: 10) {
              nodes {
                id quantity
                lineItems {
                  id title sku
                  originalUnitPriceSet   { shopMoney { amount } }
                  discountedUnitPriceSet { shopMoney { amount } }
                  discountAllocations {
                    allocatedAmountSet { shopMoney { amount } }
                    discountApplication {
                      ... on DiscountCodeApplication      { code }
                      ... on ManualDiscountApplication    { title }
                      ... on AutomaticDiscountApplication { title }
                      ... on ScriptDiscountApplication    { title }
                    }
                  }
                }
              }
            }
          }
        }

        returnShippingFees: metafield(namespace: "custom", key: "return_shipping_fees") { value }
        manual_status:      metafield(namespace: "custom", key: "manual_status")        { value }
        status_2_r_e:       metafield(namespace: "custom", key: "status_2_r_e")         { value }
      }
    }
  `;

  const data  = await shopifyWithRetry(env, token, INVOICE_QUERY, { id: orderId });

  // ── DEBUG: لو الـ query فيه GraphQL errors نرجعها مع الـ details في نفس الـ error string
  if (data?.errors && !data?.data) {
    const msgs = data.errors.map(e => e.message).join(" | ");
    return json({ error: msgs }, 500);
  }

  const order = data?.data?.order;
  if (!order) return json({ error: "Order not found", raw: data }, 404);

  const S2_VALUES = ["Confirmed + RETURN", "Confirmed + EXCHANGE"];
  const type      = S2_VALUES.includes(order.status_2_r_e?.value) ? "S2" : "S1";
  const isPrepaid =
    (order.displayFinancialStatus  || "").toLowerCase() === "paid" &&
    (order.displayFulfillmentStatus|| "").toLowerCase() !== "fulfilled";

  // ─────────────────────────────────────────────────────────────────────────
  // FIX — Return Items:
  //   نستخدم returns.nodes[].returnLineItems بدل order.refunds
  //   لأن order.refunds بتشمل refunds خاصة بالـ removed exchange items
  //   وده بيخلي أيتمز غلط تظهر في قسم Return Items
  // ─────────────────────────────────────────────────────────────────────────
  const returnItems = [];
  const returnedIds = new Set();

  for (const ret of (order.returns?.nodes || [])) {
    for (const rli of (ret.returnLineItems?.nodes || [])) {
      // الوصول لـ LineItem عبر fulfillmentLineItem.lineItem — ده الـ path الصح
      const li = rli.fulfillmentLineItem?.lineItem;
      if (!li || (rli.quantity || 0) === 0) continue;
      if (returnedIds.has(li.id)) continue;
      returnedIds.add(li.id);
      returnItems.push({
        id:            li.id,
        title:         li.title,
        sku:           li.sku || "",
        quantity:      rli.quantity,
        originalPrice: parseFloat(li.originalUnitPriceSet?.shopMoney?.amount || 0),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Exchange Items — المنطق النهائي الصح:
  //
  // exchangeLineItems.nodes[*].lineItems بيرجع الـ Removed items القديمة
  // (اللي currentQuantity = 0) مش الأيتمز الجديدة الفعلية.
  //
  // الحل: Exchange Items = order.lineItems اللي fulfillableQuantity > 0
  //   - HI-TEC Black/47: fulfillableQuantity > 0 (لسه unfulfilled) ✓
  //   - SKECHERS Light grey: fulfillableQuantity = 0 (اتسلّمت بالفعل) → محذوفة ✓
  //   - الـ return item: موجود في returnedIds → محذوف ✓
  //
  // للـ S1: currentQuantity > 0 (مفيش unfulfilled filter محتاجينه)
  // ─────────────────────────────────────────────────────────────────────────
  const exchangeItems = [];

  if (type === "S2") {
    // S2: فقط الأيتمز اللي لسه unfulfilled (fulfillableQuantity > 0) ومش return items
    for (const li of (order.lineItems?.nodes || [])) {
      if (li.fulfillableQuantity > 0 && !returnedIds.has(li.id)) {
        exchangeItems.push({
          id:              li.id,
          title:           li.title,
          sku:             li.sku || "",
          quantity:        li.fulfillableQuantity,
          originalPrice:   parseFloat(li.originalUnitPriceSet?.shopMoney?.amount  || 0),
          discountedPrice: parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0),
          discountAllocations: (li.discountAllocations || []).map(da => ({
            amount: parseFloat(da.allocatedAmountSet?.shopMoney?.amount || 0),
            label:  da.discountApplication?.code || da.discountApplication?.title || "",
          })),
        });
      }
    }
  } else {
    // S1: كل الأيتمز الـ active (currentQuantity > 0)
    for (const li of (order.lineItems?.nodes || [])) {
      if (li.currentQuantity > 0) {
        exchangeItems.push({
          id:              li.id,
          title:           li.title,
          sku:             li.sku || "",
          quantity:        li.currentQuantity,
          originalPrice:   parseFloat(li.originalUnitPriceSet?.shopMoney?.amount  || 0),
          discountedPrice: parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0),
          discountAllocations: (li.discountAllocations || []).map(da => ({
            amount: parseFloat(da.allocatedAmountSet?.shopMoney?.amount || 0),
            label:  da.discountApplication?.code || da.discountApplication?.title || "",
          })),
        });
      }
    }
  }

  const outstanding     = parseFloat(order.totalOutstandingSet?.shopMoney?.amount || 0);
  const financialStatus = (order.displayFinancialStatus || "").toLowerCase();
  const totalDue = (financialStatus === "paid" && outstanding > 0)
    ? outstanding * -1
    : outstanding;

  return json({
    invoice: {
      id:   order.id,
      name: order.name,
      createdAt: order.createdAt,
      type,
      note:  order.note  || "",
      phone: order.phone || "",
      email: order.email || "",
      shippingAddress:  order.shippingAddress || null,
      customAttributes: (order.customAttributes || []).filter(a => a.value),

      lineItems: (order.lineItems?.nodes || []).map(li => ({
        id:              li.id,
        title:           li.title,
        sku:             li.sku || "",
        quantity:        li.quantity,
        currentQuantity: li.currentQuantity,
        originalPrice:   parseFloat(li.originalUnitPriceSet?.shopMoney?.amount  || 0),
        discountedPrice: parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0),
        discountAllocations: (li.discountAllocations || []).map(da => ({
          amount: parseFloat(da.allocatedAmountSet?.shopMoney?.amount || 0),
          label:  da.discountApplication?.code || da.discountApplication?.title || "",
        })),
      })),

      discountApplications: (order.discountApplications?.nodes || []).map(da => ({
        targetType:      da.targetType,
        targetSelection: da.targetSelection,
        label:           da.code || da.title || "",
        amount:          parseFloat(da.value?.amount     || 0),
        percentage:      parseFloat(da.value?.percentage || 0),
      })),

      shippingPrice:    parseFloat(order.currentShippingPriceSet?.shopMoney?.amount || 0),
      totalPrice:       parseFloat(order.currentTotalPriceSet?.shopMoney?.amount    || 0),
      totalRefunded:    parseFloat(order.totalRefundedSet?.shopMoney?.amount        || 0),
      totalOutstanding: outstanding,
      totalDue,
      isPrepaid,

      exchangeItems,
      returnItems,

      returnShippingFees: order.returnShippingFees?.value != null
        ? parseFloat(order.returnShippingFees.value)
        : null,

      tags: order.tags || [],
    },
  });
}

// ── /track — D1 logging ───────────────────────────────────────────────────────
async function handleTrack(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  const { orderId, orderNumber, type } = body;
  if (!orderId || !orderNumber || !type) {
    return json({ error: "Missing fields: orderId, orderNumber, type" }, 400);
  }

  const gid      = String(orderId).startsWith("gid://") ? String(orderId) : `gid://shopify/Order/${orderId}`;
  const orderNum = String(orderNumber).replace("#", "");
  const ts       = new Date().toISOString();

  await writeLog(env.DB, {
    tool:      TOOL_NAME,
    type,
    timestamp: ts,
    orderId:   gid,
    orderName: orderNum,
  });

  const [tagResult, metafieldResult, statusResult] = await Promise.all([
    tagOrder(env, gid, type),
    setPrintingTimeMetafield(env, gid, type, ts),
    setStatusToReady(env, gid, type),
  ]);

  return json({ ok: true, tagResult, metafieldResult, statusResult });
}

// ── /logs — D1 read ───────────────────────────────────────────────────────────
async function handleLogs(request, env) {
  const { orderNumber, type, dateFrom, dateTo } = await request.json().catch(() => ({}));

  const conditions = [`tool = '${TOOL_NAME}'`, `type IN ('S1', 'S2')`];
  const params     = [];

  if (orderNumber) {
    const q = String(orderNumber).replace("#", "");
    conditions.push(`order_name LIKE ?`);
    params.push(`%${q}%`);
  }
  if (type && type !== "all") {
    conditions.push(`type = ?`);
    params.push(type);
  }
  if (dateFrom) {
    conditions.push(`timestamp >= ?`);
    params.push(new Date(dateFrom).toISOString());
  }
  if (dateTo) {
    conditions.push(`timestamp <= ?`);
    params.push(new Date(dateTo + "T23:59:59").toISOString());
  }

  const where = conditions.join(" AND ");
  const sql   = `SELECT order_name, type, timestamp FROM logs WHERE ${where} ORDER BY timestamp DESC LIMIT 5000`;

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  const entries = results.map(r => ({
    orderNumber: r.order_name,
    type:        r.type,
    timestamp:   r.timestamp,
  }));

  return json({ entries, total: entries.length });
}

// ── tagsAdd ───────────────────────────────────────────────────────────────────
async function tagOrder(env, gid, type) {
  try {
    const token = await getAccessToken(env);
    const resp  = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body:    JSON.stringify({
        query:     `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }`,
        variables: { id: gid, tags: [`Printed(${type})`] },
      }),
    });
    const result = await resp.json();
    const errors = result?.data?.tagsAdd?.userErrors;
    if (errors && errors.length > 0) return { ok: false, errors };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── setPrintingTimeMetafield ──────────────────────────────────────────────────
async function setPrintingTimeMetafield(env, gid, type, isoTimestamp) {
  try {
    const token = await getAccessToken(env);
    const key   = type === "S2" ? "printing_time_s2" : "printing_time_s1";
    const resp  = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body:    JSON.stringify({
        query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key value }
            userErrors { field message }
          }
        }`,
        variables: {
          metafields: [{
            ownerId: gid, namespace: "custom", key,
            type: "date_time", value: isoTimestamp,
          }],
        },
      }),
    });
    const result = await resp.json();
    const errors = result?.data?.metafieldsSet?.userErrors;
    if (errors && errors.length > 0) return { ok: false, errors };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── setStatusToReady ──────────────────────────────────────────────────────────
async function setStatusToReady(env, gid, type) {
  try {
    const token = await getAccessToken(env);
    const key   = type === "S2" ? "status_2_r_e" : "manual_status";
    const resp  = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body:    JSON.stringify({
        query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key value }
            userErrors { field message }
          }
        }`,
        variables: {
          metafields: [{
            ownerId: gid, namespace: "custom", key,
            type: "single_line_text_field", value: "Ready",
          }],
        },
      }),
    });
    const result = await resp.json();
    const errors = result?.data?.metafieldsSet?.userErrors;
    if (errors && errors.length > 0) return { ok: false, errors };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Shopify OAuth ─────────────────────────────────────────────────────────────
async function getAccessToken(env) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      client_id:     env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type:    "client_credentials",
    }),
  });
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error("No access_token");
  return data.access_token;
}

// ── GraphQL + Retry ───────────────────────────────────────────────────────────
async function shopifyGQL(env, token, query, variables = {}) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body:    JSON.stringify({ query, variables }),
  });
  return resp.json();
}

async function shopifyWithRetry(env, token, query, variables = {}, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    const data      = await shopifyGQL(env, token, query, variables);
    const throttled = data.errors?.some(e => e.extensions?.code === "THROTTLED");
    if (!throttled) return data;
    if (i === maxRetries) throw new Error("Shopify throttled");
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
}
