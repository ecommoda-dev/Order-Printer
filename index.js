// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: order-printer-worker  (ecommoda-dev)
// EcomModa — Order Printer (v2.2.0)
// skills: worker-builder v2.0.0 · constants v1.4.3 · order-lifecycle v1.3.0 — 05-09-2026
//
// Account: 762c353004e8472b20261fba273bfe8d
// Subdomain: order-printer-worker.ecommoda-dev.workers.dev
//
// Bindings (Dashboard → Settings → Bindings):
//   D1: DB → ecommoda-dev-logs (90db62d3-bd7e-4d92-912b-10fc78eeb565)
//   [لا يوجد KV — لا cache]
//
// Encrypted Vars: WORKER_SECRET, CLIENT_ID, CLIENT_SECRET
// Plain-text Vars: SHOP_DOMAIN = 6c7e1a-53.myshopify.com   (من [vars] في wrangler.toml)
//
// Endpoints — path routing (أدوات الأداة) + ?action= (المشترك القياسي):
//   POST /orders              → أوردرات S1 + S2 الجاهزة للطباعة
//   POST /invoice             → بيانات فاتورة أوردر واحد
//   POST /track               → تسجيل الطباعة + تاج + ميتافيلد الوقت + الحالة Ready
//   POST /logs                → سجل الطباعة (بعدّاد الطباعة لكل أوردر)
//   GET  ?action=check_employee · POST ?action=register_pin
//   POST ?action=verify_employee · GET ?action=log_logout · GET ?action=get_employees
//   GET  ?action=get_logs · get_logs_count · get_logs_export
//   GET  ?action=diag · get_config
//
// CHANGES (v2.2.0):
//   - 🟠 R15 — دفعة طباعة كبيرة كانت بتفشل كلها برسالة CORS. الواجهة بتبعت
//     نداء `/invoice` لكل أوردر **في نفس اللحظة** بلا أي حد تزامن، فدفعة ٥٠
//     أوردر = ٥٠ OPTIONS + ٥٠ POST متزامنين، وكل POST بياخد توكن OAuth جديد.
//     الحد نفسه اتحط في الواجهة (v3.4.0)؛ الجزء بتاع الـ Worker هنا:
//       ① كاش للتوكن في ذاكرة الـ isolate + وعد مشترك يمنع تكرار النداء —
//          دفعة ٥٠ كانت ١٠٠ نداء OAuth، بقت نداء أو تلاتة.
//       ② `Access-Control-Max-Age` — كاش الـ preflight كان ٥ ثواني (افتراضي
//          كروم) فكل POST كان بيجرّ OPTIONS معاه. دلوقتي استئذان واحد للدفعة.
//       ③ 401 من شوبيفاي بقى بيلغي التوكن المتكاش ويعيد المحاولة **مرة واحدة**
//          — من غيره توكن ملغي كان هيفضل في الكاش لحد ما TTL يخلص.
//     (بلاغ المخزن 05-09-2026 · Abo_Selim · دفعة ٥٠ أوردر · صفر صف في D1)
//
// CHANGES (v2.1.0):
//   - 🟠 R7 — الفاتورة بقت تقرا **أحدث دورة** إرجاع/استبدال بس بدل التجميع
//     على كل الدورات (Rule 15 ②). أوردر عنده دورة مقفولة + مرتجع جديد كان
//     بيطبع بنود الدورتين مع بعض، و`returnedIds` الملوّث كان بيستبعد بند
//     صالح من `exchangeItems` — **ورق غلط بيوصل للعميل**. الترتيب بالـ
//     `createdAt` وبعد فلترة CANCELED/DECLINED. والرد بقى فيه `multiCycle`
//     و`cycleCount` عشان الواجهة تنبّه المغلِّف.
//   - 🟠 R8 — `returns(first: 3)` بدون `pageInfo` كانت بتقص دورة رابعة
//     **بصمت**. بقت `first: 10` + `returnLineItems`/`exchangeLineItems`
//     `first: 50`، و`pageInfo` على التلاتة، والقصّ بيترجع في
//     `truncatedReturns` جنب `truncatedLineItems` الموجود.
//     (مراجعة 03-09-2026 · R7 + R8)
//   - 🟠 R6 — حارس `WORKER_SECRET` الغايب قبل فحص المصادقة. من غيره
//     `Bearer ${env.WORKER_SECRET}` بيتقيّم للنص الحرفي "Bearer undefined"
//     لو السيكرت اتنسي أو النسخة اتنشرت بدون Promote — فأي طلب بالرأس ده
//     كان بيعدّي المصادقة. الرد بقى 500 برسالة صريحة + step:'env'، و
//     `?action=diag` بقى بيقول مضبوط/غايب + الطول (مش القيمة).
//     (مراجعة 03-09-2026 · R6)
//
// CHANGES (v2.0.0) — كاسر:
//   - Universal D1 Auth: كل عملية طباعة بقت مربوطة بموظف (كان عمود employee فاضي)
//   - shopifyGQL بقت النسخة الحارسة (§5A ①) — كانت `return resp.json()` مجردة
//   - /track بيرجّع status: success | warning | error + actions[] + logged
//   - تحقق من التحوّل قبل كتابة Ready + تسجيل التغيير في metafields_change
//   - CORS Option B (allowlist) بدل wildcard — الأداة كتابة
//   - assertEnv + ?action=diag + ?action=get_config
//   - حذف ?action=import_logs (endpoint الترحيل المؤقت — بلا idempotency)
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════════════
const TOOL_NAME      = 'order_printer';
const WORKER_VERSION = '2.2.1';

const DATE_FROM   = '2026-04-01';
const ZONE_FILTER = ['Cairo+Giza', 'Show_Room'];

// سقف قراءة سجل الطباعة في /logs — بيرجع للواجهة كـ cap عشان التقصّ يبان
const LOGS_FETCH_MAX = 5000;

// §CONSTANTS::status — النصوص حرفية، والحالة (casing) محمولة للمعنى.
// حرف واحد مختلف بيرجّع صفر صفوف **من غير أي error**.
const S1_STATUS = {
  NEW_ORDER:      'New Order',
  CONFIRMED:      'Confirmed',
  WA_CONFIRMED:   'WhatsApp-Confirmed',
  WA_CANCELLED:   'WhatsApp-CANCELLED',
  CONFIRMED_EDIT: 'Confirmed + Edit',
  PENDING_EDIT:   'Pending Edit',
  READY:          'Ready',
  SHIPPED:        'Shipped',
  IN_RETURN:      'In-Return',
  DELIVERED:      'Delivered',
  RETURNED:       'Returned',
  CANCELLED:      'Cancelled',
};

const S2_STATUS = {
  CONFIRMED_RETURN:   'Confirmed + RETURN',
  CONFIRMED_EXCHANGE: 'Confirmed + EXCHANGE',
  READY:              'Ready',
  SHIPPED:            'Shipped',
  IN_RETURN:          'In-Return',
  RETURNED:           'Returned',
};

// §CONSTANTS::transitions — ecommoda-order-lifecycle §1.4 (S1) و §2.2 (S2).
// السياسة: ارفض + سجّل — عمرها ما تسمح في صمت.
const ALLOWED_TRANSITIONS_S1 = {
  [S1_STATUS.NEW_ORDER]:      [S1_STATUS.CONFIRMED, S1_STATUS.WA_CONFIRMED, S1_STATUS.WA_CANCELLED, S1_STATUS.CANCELLED],
  [S1_STATUS.WA_CONFIRMED]:   [S1_STATUS.CONFIRMED, S1_STATUS.CANCELLED],
  [S1_STATUS.WA_CANCELLED]:   [S1_STATUS.CANCELLED, S1_STATUS.CONFIRMED],
  [S1_STATUS.CONFIRMED]:      [S1_STATUS.READY, S1_STATUS.CONFIRMED_EDIT, S1_STATUS.PENDING_EDIT, S1_STATUS.CANCELLED],
  [S1_STATUS.CONFIRMED_EDIT]: [S1_STATUS.READY, S1_STATUS.CANCELLED],
  [S1_STATUS.PENDING_EDIT]:   [S1_STATUS.CONFIRMED_EDIT, S1_STATUS.READY, S1_STATUS.CANCELLED],
  [S1_STATUS.READY]:          [S1_STATUS.SHIPPED, S1_STATUS.CONFIRMED_EDIT, S1_STATUS.PENDING_EDIT, S1_STATUS.CANCELLED],
  [S1_STATUS.SHIPPED]:        [S1_STATUS.DELIVERED, S1_STATUS.RETURNED, S1_STATUS.IN_RETURN, S1_STATUS.READY],
  [S1_STATUS.IN_RETURN]:      [S1_STATUS.RETURNED],
  [S1_STATUS.DELIVERED]:      [],   // TERMINAL — ممنوع أي S1 بعدها
  [S1_STATUS.RETURNED]:       [],
  [S1_STATUS.CANCELLED]:      [],
};

const ALLOWED_TRANSITIONS_S2 = {
  [S2_STATUS.CONFIRMED_RETURN]:   [S2_STATUS.READY],
  [S2_STATUS.CONFIRMED_EXCHANGE]: [S2_STATUS.READY],
  [S2_STATUS.READY]:              [S2_STATUS.SHIPPED],
  [S2_STATUS.SHIPPED]:            [S2_STATUS.IN_RETURN, S2_STATUS.RETURNED],
  [S2_STATUS.IN_RETURN]:          [S2_STATUS.RETURNED],
  [S2_STATUS.RETURNED]:           [],
};

// ══════════════════════════════════════════════════════════════
// §CORS — Option B (allowlist). الأداة **كتابة** على شوبيفاي، فالـ wildcard
// مش الشكل المناسب. البوابة الفعلية لسه WORKER_SECRET في كل نداء.
// ══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];

// ⚠️ `Access-Control-Max-Age` مش تحسين رفاهية (v2.2.0 · R15).
// كل POST هنا بيحمل `Authorization` + `Content-Type: application/json`، يعني
// المتصفح **ملزم** يبعت OPTIONS preflight الأول. من غير الترويسة دي كاش الـ
// preflight في كروم بيبقى ٥ ثواني (الافتراضي)، واللي عمليًا مابينفعش مع رشقة
// متوازية — دفعة ٥٠ أوردر كانت بتطلّع ٥٠ OPTIONS + ٥٠ POST = ١٠٠ طلب متزامن.
// كروم بيسقّف القيمة دي عند ساعتين مهما كتبنا، وفايرفوكس عند ٢٤ ساعة.
const CORS_MAX_AGE = '86400';

function getCORS(request) {
  const origin  = request?.headers?.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       CORS_MAX_AGE,
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::assertEnv ───
// متغير ناقص لازم يوقف العملية **برسالة باسمه**. من غيره SHOP_DOMAIN الناقص
// بيدي `"error code: 1003" is not valid JSON` — رسالة مالهاش أي علاقة بالسبب.
const ENV_REQUIRED = {
  shopify: ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'],
};

function assertEnv(env, ...groups) {
  const missing = [];
  for (const g of groups) {
    for (const key of (ENV_REQUIRED[g] || [])) {
      if (env[key] === undefined || env[key] === null || String(env[key]).trim() === '') missing.push(key);
    }
  }
  if (!env.DB) missing.push('DB (D1 binding)');
  if (missing.length) {
    throw new Error(
      `متغيرات ناقصة في الـ Worker: ${missing.join('، ')} — ضِفها من ` +
      `Dashboard → Settings → Variables ثم Promote النسخة. (شغّل ?action=diag)`
    );
  }
}

// ─── §HELPERS::secretFingerprint — بصمة قصيرة للسر ───
// الغرض: التأكد إن كل أعضاء مجموعة `warehouse_ops` شايلين **نفس** القيمة
// (order-printer-worker · orders-packing-checker-worker · order-item-remover-worker).
// الطول لوحده مش كافي — سرّين مختلفين بنفس الطول شكلهم واحد في diag.
// ⚠️ ٨ خانات hex من SHA-256 لسر عشوائي ٣٢ بايت مش قابلة لاسترجاع القيمة.
//    وبتكشف بالظبط الحالتين اللي بتوقّعوا الناس:
//    ① عضو لسه على السر القديم   ② السر اتغيّر والـ Promote ما اتعملش
async function secretFingerprint(secret) {
  if (!secret) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(buf)].slice(0, 4)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim from ecommoda-worker-builder
//           references/shared-functions.md — never modify
// ══════════════════════════════════════════════════════════════

/**
 * Verify employee and return display_name if correct.
 * Updates last_login automatically.
 * Returns: string (display_name) or null if wrong PIN.
 * Throws: Error if account is suspended.
 */
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

/**
 * Check if employee exists and has a PIN registered.
 * Used in Login screen to decide: normal login vs first-time PIN setup.
 */
async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

/**
 * Register PIN for the first time.
 * Throws if: user not found / suspended / already has PIN.
 */
async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

/**
 * Write a log entry to D1.
 * Only tool and type are required. All other fields optional (null if not provided).
 */
async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

const LOG_EXPORT_MAX = 2000;   // سقف التصدير — بيرجع للواجهة كـ `cap`

/**
 * بنّاء شرط الفلترة الموحّد للسجل — التلات دوال تحته بتستخدمه، فمفيش SQL
 * مكرر يتعتّق في واحدة منهم ويسيب التانية.
 *
 * ⚠️ dateFrom/dateTo بيتقارنوا بـ substr(timestamp,1,10) — يعني **UTC**،
 * والعرض بتوقيت القاهرة (UTC+3). فرق التلات ساعات ممكن يحط عملية بعد ٩ مساءً
 * بتوقيت القاهرة في يوم UTC اللي بعده. مقبول لفلتر بالأيام — **بس مكتوب**.
 * login/logout مستثنيين في SQL دايمًا — مش client-side.
 */
function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

/**
 * Fetch logs from D1 with server-side filtering + pagination.
 * Max limit per page: 100 (enforced server-side).
 * ⚠️ Do NOT use this for XLSX export — use getLogsExport() instead.
 */
async function getLogs(db, { limit = 100, offset = 0, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

/**
 * Count total matching log rows.
 * Call in parallel with getLogs() (pagination UI) — and with getLogsExport().
 */
async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * Fetch all matching logs for XLSX export — up to LOG_EXPORT_MAX rows.
 * ⚠️ الدالة دي **بتقص في السكوت** بطبيعتها — الـ endpoint لازم يرجّع
 * `cap` و`total` و`truncated` كمان.
 */
async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

/**
 * بيقرا فلاتر السجل من الـ query string — CSV للقوايم
 * (employees=ahmed,sara · types=S1,S2). الاسم المفرد لسه مقبول للتوافق الرجعي.
 */
function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  return {
    tool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ══════════════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════
// ─── §SHOPIFY::getAccessToken — كاش في ذاكرة الـ isolate (v2.2.0 · R15) ───
// قبل كده كل نداء على الأداة كان بياخد توكن جديد من شوبيفاي. دفعة طباعة ٥٠
// أوردر = ٥٠ توكن لـ /invoice + ٥٠ لـ /track = **١٠٠ نداء OAuth زيادة** على
// شوبيفاي في تانية واحدة، وكلهم بيرجّعوا نفس القيمة.
//
// الكاش هنا **في ذاكرة الـ isolate بس** — مش KV ومش Cache API:
//   - مفيش binding جديد ومفيش تغيير في wrangler.toml
//   - التوكن عمره ما بيتكتب على أي تخزين دائم ولا بيخرج بره الـ isolate
//   - كلاودفلير ممكن تشغّل أكتر من isolate تحت الحمل، فالنتيجة "نداء أو تلاتة"
//     بدل ١٠٠ — مش نداء واحد مضمون رياضيًا، وده كافي تمامًا للغرض
//
// ⚠️ `_tokenInFlight` مش زيادة: من غيرها الـ ٥٠ نداء اللي بيوصلوا **مع بعض**
// لنفس الـ isolate هيلاقوا الكاش فاضي كلهم في نفس اللحظة ويطلبوا توكن كل واحد
// لوحده — يعني نفس المشكلة جوّه isolate واحد. الوعد المشترك بيخلّيهم يستنّوا
// أول نداء بدل ما يكرّروه.
let _tokenCache    = null;   // { token, expiresAt }
let _tokenInFlight = null;   // Promise<string> — نداء شغّال دلوقتي

const TOKEN_SAFETY_MS      = 5 * 60 * 1000;    // بنسيب هامش قبل الانتهاء الحقيقي
const TOKEN_FALLBACK_TTL_MS = 60 * 60 * 1000;  // لو شوبيفاي ما بعتتش expires_in

// بيتنادى من shopifyGQL على 401 — توكن ملغي مايفضلش في الكاش لحد ما TTL يخلص
function invalidateAccessToken() {
  _tokenCache    = null;
  _tokenInFlight = null;
}

async function fetchAccessToken(env) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in response');

  const ttlMs = Number.isFinite(data.expires_in) && data.expires_in > 0
    ? data.expires_in * 1000
    : TOKEN_FALLBACK_TTL_MS;

  return {
    token:     data.access_token,
    // Math.max عشان توكن قصير العمر (أقل من الهامش) مايبقاش منتهي وهو لسه جديد
    expiresAt: Date.now() + Math.max(ttlMs - TOKEN_SAFETY_MS, 30 * 1000),
  };
}

async function getAccessToken(env) {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) return _tokenCache.token;
  if (_tokenInFlight) return _tokenInFlight;

  _tokenInFlight = (async () => {
    const fresh = await fetchAccessToken(env);
    _tokenCache = fresh;
    return fresh.token;
  })();

  try {
    return await _tokenInFlight;
  } finally {
    // بيتصفّر في الحالتين — نجح (الكاش اتملى) أو فشل (المحاولة الجاية تعيد)
    _tokenInFlight = null;
  }
}

// ─── §SHOPIFY::shopifyGQL — العقد الإلزامي، منسوخة كما هي ───
// أي فشل بيترمي. مفيش رد بيعدّي وهو فاشل:
//   ① فشل شبكة  ② HTTP status  ③ رد مش JSON  ④ data.errors  ⑤ data فاضية
// ⚠️ ④ هو الخطير: لما ميوتيشن تترفض على مستوى الحقل (صلاحية ناقصة مثلاً)
// شوبيفاي بترد {"errors":[…],"data":null} — والـ userErrors بتبقى [] لأن مفيش
// payload أصلاً. كود بيفحص userErrors بس بيقرا ده **نجاح**.
// (كلّف EcomModa ٤ أيام استرجاع مخزون وهمي — 19→23-08-2026)
async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify') {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  let tokenRefreshed = false;   // v2.2.0 · R15 — مرة واحدة بس، مش لوب

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body:    JSON.stringify({ query, variables }),
      });
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    // ⚠️ 401 بقى ليه فرع خاص من v2.2.0 (R15) — لأن التوكن بقى متكاش.
    // من غير ده: توكن اتلغى أو اتغيّر من ناحية شوبيفاي بيفضل في الكاش لحد ما
    // الـ TTL يخلص، فكل نداء في الفترة دي بيفشل بنفس الشكل والأداة تبان واقعة.
    // بنلغي الكاش، نجيب توكن جديد، ونعيد **مرة واحدة** — لو رد 401 تاني يبقى
    // المشكلة في CLIENT_ID/CLIENT_SECRET أو الصلاحيات، مش في توكن بايت.
    if (resp.status === 401 && !tokenRefreshed && attempt < MAX_ATTEMPTS) {
      tokenRefreshed = true;
      invalidateAccessToken();
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP 401 — ${text.slice(0, 180)}`);
      try {
        token = await getAccessToken(env);
        continue;
      } catch (e) {
        throw new Error(`${opName}: شوبيفاي ردّت 401 وتجديد التوكن فشل — ${e.message}`);
      }
    }

    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(
        `${opName}: ${data.errors.map(e => e.message).join(' | ')}` +
        (codes.length ? ` [${codes.join(',')}]` : '')
      );
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1200 * attempt)); continue;
      }
      throw lastErr;
    }

    if (!data.data) throw new Error(`${opName}: رد شوبيفاي بدون data — ${text.slice(0, 180)}`);
    return data;
  }
  throw lastErr || new Error(`${opName}: فشل غير معروف`);
}

// ══════════════════════════════════════════════════════════════
// §PRINT
// ══════════════════════════════════════════════════════════════

// ─── §PRINT::LIST_QUERY + fetchByQuery ───
const LIST_QUERY = `
  query GetOrders($cursor: String, $q: String!) {
    orders(first: 250, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id legacyResourceId name createdAt tags
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

// ⚠️ الصفحة الفاشلة **بتفشل النداء كله**. النسخة القديمة كانت `if (!orders) break;`
// — يعني قايمة أوردرات مقصوصة بتوصل للموظف من غير أي رسالة.
async function fetchByQuery(env, token, q) {
  const results = [];
  let cursor = null, hasNext = true, page = 0;

  while (hasNext) {
    page++;
    const data   = await shopifyGQL(env, token, LIST_QUERY, { cursor, q }, `orders_page_${page}`);
    const orders = data?.data?.orders;
    if (!orders) throw new Error(`فشل جلب الصفحة ${page} من الأوردرات — رد شوبيفاي بدون orders`);

    for (const { node } of orders.edges) results.push(node);

    // cursor-stuck guard — الحماية الحقيقية الوحيدة من اللوب اللانهائي
    if (orders.pageInfo.hasNextPage && orders.pageInfo.endCursor === cursor) {
      throw new Error(`Pagination stuck عند الصفحة ${page} — الـ cursor لم يتقدم`);
    }
    hasNext = orders.pageInfo.hasNextPage;
    cursor  = orders.pageInfo.endCursor;
  }

  return results;
}

// ─── §PRINT::handleOrders ───
async function handleOrders(request, env) {
  assertEnv(env, 'shopify');
  await request.json().catch(() => ({}));

  const token = await getAccessToken(env);

  const [s1ConfirmedNodes, s1EditNodes, s2ReturnNodes, s2ExchangeNodes] = await Promise.all([
    fetchByQuery(env, token,
      `metafields.custom.manual_status:${JSON.stringify(S1_STATUS.CONFIRMED)} created_at:>=${DATE_FROM}`),
    fetchByQuery(env, token,
      `metafields.custom.manual_status:${JSON.stringify(S1_STATUS.CONFIRMED_EDIT)} created_at:>=${DATE_FROM}`),
    fetchByQuery(env, token,
      `metafields.custom.status_2_r_e:${JSON.stringify(S2_STATUS.CONFIRMED_RETURN)} created_at:>=${DATE_FROM}`),
    fetchByQuery(env, token,
      `metafields.custom.status_2_r_e:${JSON.stringify(S2_STATUS.CONFIRMED_EXCHANGE)} created_at:>=${DATE_FROM}`),
  ]);

  const merged = [
    ...s1ConfirmedNodes.map(o => ({ ...o, type: 'S1', status: o.manual_status?.value || '' })),
    ...s1EditNodes.map(o      => ({ ...o, type: 'S1', status: o.manual_status?.value || '' })),
    ...s2ReturnNodes.map(o    => ({ ...o, type: 'S2', status: o.status_2_r_e?.value || '' })),
    ...s2ExchangeNodes.map(o  => ({ ...o, type: 'S2', status: o.status_2_r_e?.value || '' })),
  ];

  // ⚠️ ZONE_FILTER بيفلتر بصمت — بنرجّع العدد المستبعَد عشان "الأوردر مش ظاهر"
  // يبقى ليه إجابة على الشاشة بدل ما يبقى تشخيص يدوي في كل مرة.
  const zoneFiltered = merged.filter(o => ZONE_FILTER.includes(o.zone?.value));
  const zoneExcluded = merged.length - zoneFiltered.length;

  const allOrders = zoneFiltered.map(o => ({
    id:        o.id,
    orderId:   o.legacyResourceId || String(o.id).split('/').pop(),
    name:      o.name,
    createdAt: o.createdAt,
    customer:  [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || '-',
    type:      o.type,
    status:    o.status,
    total:     parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
    tags:      o.tags || [],
    isPrinted: (o.tags || []).includes(`Printed(${o.type})`),
  }));

  allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return json({
    ok:           true,
    orders:       allOrders,
    total:        allOrders.length,
    zoneExcluded,
    zoneFilter:   ZONE_FILTER,
    fetchedAt:    new Date().toISOString(),
    source:       'shopify',
  }, 200, request);
}

// ─── §PRINT::handleInvoice ───
const INVOICE_QUERY = `
  query GetInvoice($id: ID!) {
    order(id: $id) {
      id legacyResourceId name createdAt
      note phone email
      displayFinancialStatus displayFulfillmentStatus
      tags
      shippingAddress { name company address1 address2 city province phone }
      customAttributes { key value }

      lineItems(first: 50) {
        pageInfo { hasNextPage }
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

      # R7 + R8 (v2.1.0):
      #   - first: 3 -> first: 10 — دورة رابعة كانت بتتقص بصمت
      #   - pageInfo على التلاتة — القص بيترجع في truncatedReturns
      #   - createdAt و closedAt لازمين لاختيار احدث دورة (Rule 15 ثانيا)
      returns(first: 10) {
        pageInfo { hasNextPage }
        nodes {
          id status createdAt closedAt

          returnLineItems(first: 50) {
            pageInfo { hasNextPage }
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

          exchangeLineItems(first: 50) {
            pageInfo { hasNextPage }
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

async function handleInvoice(request, env) {
  assertEnv(env, 'shopify');
  const { orderId } = await request.json().catch(() => ({}));
  if (!orderId) return json({ error: 'Missing orderId' }, 400, request);

  const token = await getAccessToken(env);

  // shopifyGQL بترمي على أي فشل — مفيش داعي لفحص data.errors هنا تاني
  const data  = await shopifyGQL(env, token, INVOICE_QUERY, { id: orderId }, 'invoice');
  const order = data?.data?.order;
  if (!order) return json({ error: 'Order not found' }, 404, request);

  const S2_VALUES = [S2_STATUS.CONFIRMED_RETURN, S2_STATUS.CONFIRMED_EXCHANGE];
  const type      = S2_VALUES.includes(order.status_2_r_e?.value) ? 'S2' : 'S1';
  const isPrepaid =
    (order.displayFinancialStatus   || '').toLowerCase() === 'paid' &&
    (order.displayFulfillmentStatus || '').toLowerCase() !== 'fulfilled';

  // ══════════════════════════════════════════════════════════════
  // Return Items — من returns.nodes[].returnLineItems مش order.refunds
  // (order.refunds بتشمل refunds خاصة بالـ removed exchange items)
  //
  // ⚠️ R7 (v2.1.0) — **أحدث دورة بس، مش تجميع على كل الدورات** (Rule 15 ②)
  //
  //    الحلقة القديمة كانت بتلف على `order.returns.nodes` كلها. أوردر عنده
  //    دورة استبدال مقفولة من الشهر اللي فات + مرتجع جديد مفتوح كان بيدي:
  //      · بنود الدورتين مع بعض في `returnItems` → الفاتورة بتطبع بنود
  //        دورة اتسوّت خلاص كأنها راجعة دلوقتي
  //      · و`returnedIds` بقى فيه بنود قديمة → السطر تحت بيستبعد بند صالح
  //        من `exchangeItems`
  //    **النتيجة: ورق غلط بيوصل للعميل.**
  //
  //    Pack Checker محمي من نفس المشكلة **بالصدفة**: شرط `if (qty > 0)` جوّه
  //    `classifyOrderItems` بيرمي بنود الدورات المنتهية. الطابعة مافيهاش
  //    الشرط ده لأنها بتقرا الكمية من `returnLineItems.quantity` مباشرةً.
  //
  //    التكرار المقاس: ١١ أوردر multi-cycle من ١١,٢٤٠ (26-08-2026، Rule 15).
  //    نادر — بس الأثر ورق مطبوع غلط، مش رقم في تقرير.
  //
  // ⚠️ الترتيب بالـ `createdAt` مش بترتيب المصفوفة — شوبيفاي مش ضامنة ترتيب
  //    `returns.nodes`، والاعتماد عليه بيدي «أحدث دورة» عشوائية.
  //    والمقارنة بـ `new Date()` مش نصيًا.
  // ══════════════════════════════════════════════════════════════
  const cycles = (order.returns?.nodes || [])
    .filter(r => !['CANCELED', 'DECLINED'].includes(r.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const currentCycle = cycles[cycles.length - 1] || null;

  const returnItems = [];
  const returnedIds = new Set();

  for (const rli of (currentCycle?.returnLineItems?.nodes || [])) {
    const li = rli.fulfillmentLineItem?.lineItem;
    if (!li || (rli.quantity || 0) === 0) continue;
    if (returnedIds.has(li.id)) continue;
    returnedIds.add(li.id);
    returnItems.push({
      id:            li.id,
      title:         li.title,
      sku:           li.sku || '',
      quantity:      rli.quantity,
      originalPrice: parseFloat(li.originalUnitPriceSet?.shopMoney?.amount || 0),
    });
  }

  // R8 — القصّ في أي مستوى من الـ returns بيترجع للواجهة بدل ما يعدّي صامت.
  //      الطابعة كانت على `first: 3` **بدون `pageInfo`** — دورة رابعة كانت
  //      بتختفي من غير أي أثر، وهو بالظبط نوع الفشل اللي `truncatedLineItems`
  //      اتضاف عشانه في نفس الملف.
  const truncatedReturns =
    order.returns?.pageInfo?.hasNextPage === true ||
    (order.returns?.nodes || []).some(r =>
      r.returnLineItems?.pageInfo?.hasNextPage === true ||
      r.exchangeLineItems?.pageInfo?.hasNextPage === true);

  // Exchange Items:
  //   S2 → أيتمز لسه unfulfilled (fulfillableQuantity > 0) ومش return items
  //   S1 → كل الأيتمز الـ active (currentQuantity > 0)
  const exchangeItems = [];
  const mapItem = (li, qty) => ({
    id:              li.id,
    title:           li.title,
    sku:             li.sku || '',
    quantity:        qty,
    originalPrice:   parseFloat(li.originalUnitPriceSet?.shopMoney?.amount   || 0),
    discountedPrice: parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0),
    discountAllocations: (li.discountAllocations || []).map(da => ({
      amount: parseFloat(da.allocatedAmountSet?.shopMoney?.amount || 0),
      label:  da.discountApplication?.code || da.discountApplication?.title || '',
    })),
  });

  for (const li of (order.lineItems?.nodes || [])) {
    if (type === 'S2') {
      if (li.fulfillableQuantity > 0 && !returnedIds.has(li.id)) exchangeItems.push(mapItem(li, li.fulfillableQuantity));
    } else {
      if (li.currentQuantity > 0) exchangeItems.push(mapItem(li, li.currentQuantity));
    }
  }

  const outstanding     = parseFloat(order.totalOutstandingSet?.shopMoney?.amount || 0);
  const financialStatus = (order.displayFinancialStatus || '').toLowerCase();
  const totalDue = (financialStatus === 'paid' && outstanding > 0) ? outstanding * -1 : outstanding;

  return json({
    ok: true,
    // ⚠️ الفاتورة أوسع من 50 بند = بنود مش هتتطبع، من غير أي error
    truncatedLineItems: order.lineItems?.pageInfo?.hasNextPage === true,
    // R8 — دورات إرجاع/استبدال اتقصّت (أكتر من 10 دورات أو 50 بند في دورة)
    truncatedReturns,
    // R7 — الأوردر عنده أكتر من دورة: الفاتورة بتعرض **أحدث** دورة بس،
    //      والواجهة بتنبّه المغلِّف إنه يراجع.
    multiCycle:      cycles.length > 1,
    cycleCount:      cycles.length,
    currentCycleId:  currentCycle?.id     || null,
    currentCycleAt:  currentCycle?.createdAt || null,
    invoice: {
      id:        order.id,
      orderId:   order.legacyResourceId || String(order.id).split('/').pop(),
      name:      order.name,
      createdAt: order.createdAt,
      type,
      note:  order.note  || '',
      phone: order.phone || '',
      email: order.email || '',
      shippingAddress:  order.shippingAddress || null,
      customAttributes: (order.customAttributes || []).filter(a => a.value),

      lineItems: (order.lineItems?.nodes || []).map(li => ({
        ...mapItem(li, li.quantity),
        currentQuantity: li.currentQuantity,
      })),

      discountApplications: (order.discountApplications?.nodes || []).map(da => ({
        targetType:      da.targetType,
        targetSelection: da.targetSelection,
        label:           da.code || da.title || '',
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
  }, 200, request);
}

// ─── §PRINT::readCurrentStatus ───
// بيقرا الحالة الحالية قبل أي كتابة — ده شرط تنفيذ قاعدة التحوّل
// (ecommoda-order-lifecycle §1.4): ممنوع تكتب حالة من غير ما تعرف الحالة اللي
// قبلها. وهو كمان مصدر value_before في سجل metafields_change.
const STATUS_QUERY = `
  query OrderStatus($id: ID!) {
    order(id: $id) {
      id name
      manual_status: metafield(namespace: "custom", key: "manual_status") { value }
      status_2_r_e:  metafield(namespace: "custom", key: "status_2_r_e")  { value }
    }
  }
`;

async function readCurrentStatus(env, token, gid, type) {
  const data  = await shopifyGQL(env, token, STATUS_QUERY, { id: gid }, 'orderStatus');
  const order = data?.data?.order;
  if (!order) throw new Error('الأوردر غير موجود على شوبيفاي');
  return type === 'S2'
    ? (order.status_2_r_e?.value  ?? null)
    : (order.manual_status?.value ?? null);
}

// ─── §PRINT::tagOrder ───
// الفحوصات التلاتة: ① top-level (جوّه shopifyGQL) ② userErrors ③ تأكيد الـ payload
async function tagOrder(env, token, gid, type, actions) {
  const MUTATION = `
    mutation tagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
    }`;
  const tag  = `Printed(${type})`;
  const data = await shopifyGQL(env, token, MUTATION, { id: gid, tags: [tag] }, 'tagsAdd');

  const result = data.data?.tagsAdd;
  const errs   = result?.userErrors || [];
  if (errs.length) throw new Error(`tagsAdd: ${errs.map(e => e.message).join(' | ')}`);
  if (!result?.node?.id) throw new Error('tagsAdd: شوبيفاي ما أكدتش إضافة التاج');

  actions.push(`تاج ${tag}`);
  return true;
}

// ─── §PRINT::setPrintingTimeMetafield ───
async function setPrintingTimeMetafield(env, token, gid, type, isoTimestamp, actions) {
  const key      = type === 'S2' ? 'printing_time_s2' : 'printing_time_s1';
  const MUTATION = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }`;
  const data = await shopifyGQL(env, token, MUTATION, {
    metafields: [{ ownerId: gid, namespace: 'custom', key, type: 'date_time', value: isoTimestamp }],
  }, 'metafieldsSet:printing_time');

  const result = data.data?.metafieldsSet;
  const errs   = result?.userErrors || [];
  if (errs.length) throw new Error(`printing_time: ${errs.map(e => e.message).join(' | ')}`);
  if (!result?.metafields?.length) throw new Error('printing_time: شوبيفاي ما أكدتش كتابة الميتافيلد');

  actions.push(`وقت الطباعة (${key})`);
  return true;
}

// ─── §PRINT::setStatusToReady ───
// بترجّع { written, skipped?, before } — والرفض بيترمي برسالة واضحة.
async function setStatusToReady(env, token, gid, type, statusBefore, actions) {
  const key    = type === 'S2' ? 'status_2_r_e' : 'manual_status';
  const target = type === 'S2' ? S2_STATUS.READY : S1_STATUS.READY;
  const map    = type === 'S2' ? ALLOWED_TRANSITIONS_S2 : ALLOWED_TRANSITIONS_S1;

  // الحالة الحالية = الهدف → مفيش تحوّل أصلاً (إعادة طباعة). مش خطأ ومش كتابة.
  if (statusBefore === target) {
    actions.push(`الحالة بالفعل ${target} — مفيش تغيير`);
    return { written: false, skipped: 'same_value' };
  }

  // ⚠️ ارفض + سجّل — عمرها ما تسمح في صمت (lifecycle §1.4)
  const allowed = map[statusBefore];
  if (!allowed) {
    throw new Error(
      `تحوّل مرفوض: الحالة الحالية "${statusBefore ?? '(فاضية)'}" مش قيمة معروفة في ماكينة ${type}`
    );
  }
  if (!allowed.includes(target)) {
    throw new Error(
      `تحوّل مرفوض: "${statusBefore}" → "${target}" مش مسموح في ماكينة ${type}` +
      (statusBefore === S1_STATUS.DELIVERED ? ' — Delivered حالة نهائية' : '')
    );
  }

  const MUTATION = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }`;
  const data = await shopifyGQL(env, token, MUTATION, {
    metafields: [{ ownerId: gid, namespace: 'custom', key, type: 'single_line_text_field', value: target }],
  }, 'metafieldsSet:status');

  const result = data.data?.metafieldsSet;
  const errs   = result?.userErrors || [];
  if (errs.length) throw new Error(`${key}: ${errs.map(e => e.message).join(' | ')}`);
  // الفحص ③ — مش بس "مفيش اعتراض"، القيمة اللي رجعت هي اللي طلبناها فعلاً
  const written = result?.metafields?.find(m => m.key === key);
  if (!written || written.value !== target) {
    throw new Error(`${key}: شوبيفاي ما أكدتش كتابة الحالة "${target}"`);
  }

  actions.push(`الحالة ${statusBefore ?? '(فاضية)'} → ${target}`);
  return { written: true, before: statusBefore, after: target };
}

// ─── §PRINT::handleTrack ───
// النتيجة **تلات حالات مش اتنين**، والأكشنز بتتملي أول بأول من مصفوفة ممرّرة
// من بره — عشان استثناء في النص ما يخليش السجل يقول "ما حصلش حاجة".
async function handleTrack(request, env) {
  assertEnv(env, 'shopify');

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400, request);

  const { orderId, orderNumber, type, employee } = body;
  if (!orderId || !orderNumber || !type) {
    return json({ error: 'Missing fields: orderId, orderNumber, type' }, 400, request);
  }
  if (type !== 'S1' && type !== 'S2') {
    return json({ error: `type غير صالح: "${type}" — المسموح S1 أو S2` }, 400, request);
  }
  // كل عملية طباعة مربوطة بموظف — عمود employee كان فاضي في كل الصفوف التاريخية
  if (!employee) {
    return json({ error: 'employee مطلوب — سجّل الدخول أولاً' }, 400, request);
  }

  const gid      = String(orderId).startsWith('gid://') ? String(orderId) : `gid://shopify/Order/${orderId}`;
  const numericId = gid.split('/').pop();
  const orderNum = String(orderNumber).replace('#', '');
  const ts       = new Date().toISOString();

  const actions  = [];
  const warnings = [];
  const errors   = [];

  const token = await getAccessToken(env);

  // ① الحالة الحالية — من غيرها مفيش تحقق من التحوّل ومفيش value_before
  let statusBefore = null, statusReadOk = true;
  try {
    statusBefore = await readCurrentStatus(env, token, gid, type);
  } catch (e) {
    statusReadOk = false;
    warnings.push(`تعذّر قراءة الحالة الحالية — الحالة ما اتغيّرتش: ${e.message}`);
  }

  // ② التلات كتابات — كل واحدة بترمي، والفشل بيتجمّع مش بيتبلع
  const tasks = [
    tagOrder(env, token, gid, type, actions)
      .catch(e => { errors.push(`التاج: ${e.message}`); }),
    setPrintingTimeMetafield(env, token, gid, type, ts, actions)
      .catch(e => { errors.push(`وقت الطباعة: ${e.message}`); }),
  ];

  let statusChange = null;
  if (statusReadOk) {
    tasks.push(
      setStatusToReady(env, token, gid, type, statusBefore, actions)
        .then(r => { if (r.written) statusChange = r; })
        .catch(e => { errors.push(`الحالة: ${e.message}`); })
    );
  }
  await Promise.all(tasks);

  // ③ سجل تغيير الحالة — المصدر الوحيد لزمن الدورة وعدد المحاولات
  //    (lifecycle قاعدة 9: الميتافيلد بيحمل الحالة · D1 بيحمل التاريخ)
  let statusLogged = null;
  if (statusChange) {
    statusLogged = true;
    try {
      await writeLog(env.DB, {
        tool:        'metafields_change',
        type:        'update',
        timestamp:   ts,
        employee,
        orderId:     numericId,
        orderName:   orderNum,
        valueBefore: statusChange.before,
        valueAfter:  statusChange.after,
        notes:       `${type}: ${statusChange.before ?? '(فاضية)'} → ${statusChange.after} (طباعة الفاتورة)`,
        extra:       { source: TOOL_NAME, metafieldKey: type === 'S2' ? 'status_2_r_e' : 'manual_status', printType: type },
      });
    } catch (e) {
      statusLogged = false;
      warnings.push(`الحالة اتغيّرت بس تسجيلها في metafields_change فشل: ${e.message}`);
    }
  }

  // ④ الحالة النهائية — تلاتة، مش اتنين
  const status = errors.length
    ? (actions.length ? 'warning' : 'error')
    : (warnings.length ? 'warning' : 'success');

  // ⑤ سجل الطباعة نفسه — بيتكتب **بعد** الأفعال عشان يقول اللي حصل فعلاً
  let logged = true, logError = null;
  try {
    await writeLog(env.DB, {
      tool:      TOOL_NAME,
      type,
      timestamp: ts,
      employee,
      orderId:   numericId,
      orderName: orderNum,
      notes:     actions.join(' · ') || 'مفيش أي فعل تم',
      extra:     { result: { status, actions, warnings, errors, statusBefore, statusLogged } },
    });
  } catch (e) {
    logged = false; logError = e.message;   // الطباعة حصلت — بس مفيش سجل
  }

  return json({
    ok: status !== 'error',
    status, actions, warnings, errors,
    orderId:     numericId,
    orderNumber: `#${orderNum}`,
    type,
    statusBefore,
    logged, logError,
  }, 200, request);
}

// ─── §PRINT::handleLogs ───
// سجل الطباعة بعدّاد لكل أوردر (الواجهة بتبني منه isPrinted + "طُبع كام مرة").
// ⚠️ بيقص عند LOGS_FETCH_MAX — والتقصّ بيرجع صراحةً عشان مايبانش نجاح كامل.
async function handleLogs(request, env) {
  const { orderNumber, type, dateFrom, dateTo } =
    await request.json().catch(() => ({}));

  const filters = {
    tool:  TOOL_NAME,
    types: ['S1', 'S2'],
    search:   orderNumber ? String(orderNumber).replace('#', '') : null,
    dateFrom: dateFrom || null,
    dateTo:   dateTo   || null,
  };
  if (type && type !== 'all') filters.types = [type];

  const { sql, b } = buildLogFilterSQL(
    'SELECT order_name, type, timestamp, employee', filters);

  const [{ results }, total] = await Promise.all([
    env.DB.prepare(sql + ' ORDER BY timestamp DESC LIMIT ?').bind(...b, LOGS_FETCH_MAX).all(),
    getLogsCount(env.DB, filters),
  ]);

  const entries = results.map(r => ({
    orderNumber: r.order_name,
    type:        r.type,
    timestamp:   r.timestamp,
    employee:    r.employee,
  }));

  return json({
    ok: true,
    entries,
    count:     entries.length,
    total,
    cap:       LOGS_FETCH_MAX,
    truncated: total > LOGS_FETCH_MAX,
  }, 200, request);
}

// ─── §PRINT::runDiag ───
// فحص ذاتي **بدون أي كتابة**. ⚠️ ممنوع يرجّع قيمة أي سر — الأسماء والأطوال بس.
async function runDiag(request, env) {
  const envKeys = Object.keys(env).sort().map(name => {
    const v = env[name];
    return typeof v === 'string'
      ? { name, kind: 'string', length: v.length }   // الطول بيكشف المسافة المخفية في الاسم/القيمة
      : { name, kind: v ? 'binding' : 'empty', length: null };
  });

  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  // متغيرات
  try { assertEnv(env, 'shopify'); push('المتغيرات والـ bindings', true, 'كل المطلوب موجود'); }
  catch (e) { push('المتغيرات والـ bindings', false, e.message); }

  // R6: WORKER_SECRET — الاسم والطول بس، **مش القيمة**. الطول بيكشف المسافة
  // المخفية اللي بتخلي المقارنة تفشل بلا سبب ظاهر.
  // البصمة بتثبت إن أعضاء مجموعة `warehouse_ops` على **نفس** القيمة —
  // الطول لوحده مابيثبتش حاجة. اختلافها في أي أداة = المجموعة مكسورة.
  const secretFp = await secretFingerprint(env.WORKER_SECRET);
  push('WORKER_SECRET', !!env.WORKER_SECRET,
    env.WORKER_SECRET
      ? `مضبوط (${String(env.WORKER_SECRET).length} حرف) · بصمة ${secretFp} · مجموعة warehouse_ops`
      : 'غايب — أي طلب بـ "Bearer undefined" كان هيعدّي المصادقة قبل حارس R6');

  // D1
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?').bind(TOOL_NAME).first();
    push('D1 (DB → ecommoda-dev-logs)', true, `${row?.n ?? 0} صف لـ ${TOOL_NAME}`);
  } catch (e) { push('D1 (DB → ecommoda-dev-logs)', false, e.message); }

  // جدول الموظفين — الدخول بيعتمد عليه
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM employees WHERE is_active = 1').first();
    push('جدول الموظفين', true, `${row?.n ?? 0} موظف نشط`);
  } catch (e) { push('جدول الموظفين', false, e.message); }

  // شوبيفاي: OAuth + صلاحيات التطبيق
  try {
    const token = await getAccessToken(env);
    push('Shopify OAuth', true, 'التوكن اتجاب');
    try {
      const data = await shopifyGQL(env, token,
        '{ currentAppInstallation { accessScopes { handle } } }', {}, 'diag:scopes');
      const scopes = (data.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
      const needed = ['read_orders', 'write_orders'];
      const missing = needed.filter(s => !scopes.includes(s));
      push('صلاحيات تطبيق شوبيفاي', missing.length === 0,
        missing.length ? `ناقص: ${missing.join('، ')} — المتاح: ${scopes.join('، ')}` : scopes.join('، '));
    } catch (e) { push('صلاحيات تطبيق شوبيفاي', false, e.message); }
  } catch (e) { push('Shopify OAuth', false, e.message); }

  const origin = request.headers.get('Origin') || '(بدون Origin)';
  push('Origin', ALLOWED_ORIGINS.includes(origin), `${origin} — المسموح: ${ALLOWED_ORIGINS.join('، ')}`);

  return json({
    ok: checks.every(c => c.ok),
    version: WORKER_VERSION,
    tool:    TOOL_NAME,
    checks,
    envKeys,
  }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // ALWAYS first: CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // ── R6: حارس WORKER_SECRET الغايب — **قبل** أي مقارنة ─────────
    // من غير السطور دي: لو السيكرت اتنسي أو النسخة اتنشرت بدون Promote،
    // يبقى env.WORKER_SECRET === undefined، والقالب بيتقيّم للنص الحرفي
    // "Bearer undefined" — فأي طلب بالرأس ده **بيعدّي المصادقة**.
    // (مراجعة 03-09-2026 · R6 · نفس حارس logistics-control-center-worker)
    if (!env.WORKER_SECRET) {
      return json({
        error: 'WORKER_SECRET غير مضبوط على الـ Worker — أضفه من Settings → Variables ثم اعمل Promote',
        step:  'env',
      }, 500, request);
    }

    // ALWAYS second: WORKER_SECRET check
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401, request);
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const action = url.searchParams.get('action') || '';

    try {

      // ─── §AUTH ────────────────────────────────────────────────
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        // الدخول نفسه نجح فعلاً — فشل D1 بعد كده يترجع logged:false مش 500
        let logged = true;
        try {
          await writeLog(env.DB, {
            tool: TOOL_NAME, type: 'login', employee: username, notes: `دخول: ${displayName}`,
          });
        } catch (e) { logged = false; }
        return json({ ok: true, displayName, logged }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        let logged = true;
        if (username) {
          try {
            await writeLog(env.DB, {
              tool: TOOL_NAME, type: 'logout', employee: username,
              notes: `خروج: ${username.replace(/_/g, ' ')}`,
            });
          } catch (e) { logged = false; }
        }
        return json({ ok: true, logged }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ──────────────────────────────────────────────────────────

      // ─── §DIAG ────────────────────────────────────────────────
      if (action === 'get_config') {
        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME }, 200, request);
      }
      if (action === 'diag') {
        return runDiag(request, env);
      }
      // ──────────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS ───────────────────────────────────────
      if (action === 'get_logs') {
        const p      = logParamsFrom(url, TOOL_NAME);
        const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '100'), 100);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'),    0);
        const entries = await getLogs(env.DB, { ...p, limit, offset });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, logParamsFrom(url, TOOL_NAME));
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const p = logParamsFrom(url, TOOL_NAME);
        const [entries, total] = await Promise.all([
          getLogsExport(env.DB, p),
          getLogsCount(env.DB, p),
        ]);
        return json({ ok: true, entries, cap: LOG_EXPORT_MAX, total,
                      truncated: total > LOG_EXPORT_MAX }, 200, request);
      }
      // ──────────────────────────────────────────────────────────

      // ─── §PRINT (path routing — الشكل التاريخي للأداة) ─────────
      if (method === 'POST' && path === '/orders')  return handleOrders(request, env);
      if (method === 'POST' && path === '/invoice') return handleInvoice(request, env);
      if (method === 'POST' && path === '/track')   return handleTrack(request, env);
      if (method === 'POST' && path === '/logs')    return handleLogs(request, env);
      // ──────────────────────────────────────────────────────────

      return json({ error: 'Not found' }, 404, request);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500, request);
    }
  },
};
