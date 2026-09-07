// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: order-printer-worker  (ecommoda-dev)
// EcomModa — Order Printer (v2.5.0)
// skills: worker-builder v2.0.0 · constants v1.4.3 · order-lifecycle v1.3.0 ·
//         bosta-api-helper — 07-09-2026
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
//   POST /lookup              → أوردر **واحد** بعينه مهما كانت حالته (إعادة طباعة)
//   POST /invoice             → بيانات فاتورة أوردر واحد
//   POST /track               → تسجيل الطباعة + تاج + ميتافيلد الوقت + الحالة Ready
//   POST /logs                → سجل الطباعة (بعدّاد الطباعة لكل أوردر)
//   POST ?action=bosta_lookup → تحويل أرقام أوردرات لشحنات بوسطة (قراءة بحتة + not_found)
//   POST ?action=bosta_awb    → جلب البوليصة/البوالص كـ base64 PDF (قراءة بحتة)
//   GET  ?action=check_employee · POST ?action=register_pin
//   POST ?action=verify_employee · GET ?action=log_logout · GET ?action=get_employees
//   GET  ?action=get_logs · get_logs_count · get_logs_export
//   GET  ?action=diag · get_config
//
// CHANGES (v2.5.0) — دمج طباعة بوليصة بوسطة:
//   - 🔴 القناة الأكبر في المتجر بقى لها طابور. `custom.zone = Other_Regions`
//     معناه **بوسطة** (`ecommoda-order-lifecycle` → `zone-routing.md`)، وكان
//     `ZONE_FILTER` بيستبعدها من `/orders` من غير أي أثر على الشاشة — يعني
//     ٩٬٠٨٣ أوردر (مقابل ٧٬١١٣ لـ Cairo+Giza) مالهمش طابور طباعة أصلاً.
//   - `/orders` بقى بيرجّع `zone` · `channel` · `zoneKnown` لكل أوردر، وبياخد
//     `allZones` اختيارية:
//       غايبة / false → **السلوك القديم بالحرف** (`ZONE_FILTER` بيفلتر)
//                        ← ده اللي بيحافظ على `Order-Printer/index.html`
//                          المستقلة مجمّدة على قاهرة+جيزة زي ما هي
//       true          → كل الأوردرات بقنواتها، **و`BLANK`/الفاضي/غير المعروف
//                        بيتعرضوا** بـ `channel: null` (قرار أحمد 07-09-2026)
//   - `?action=bosta_lookup` — تحويل أرقام الأوردرات لشحنات بوسطة. **قراءة
//     بحتة على بوسطة**، وبترجّع كل اللي البوابة محتاجاه في نداء واحد:
//     `deliveryId` · `stateCode` · `type` · `cod`. والفلترة القبلية بالحالة
//     هنا هي اللي بتمنع السقوط الصامت في `mass-awb` (تحت).
//   - `?action=bosta_awb` — البوليصة كـ base64 PDF. مفرد (v1) أو مجمّع
//     (`mass-awb` · v2)، والمجمّع بيتحقق من **عدد صفحات الـ PDF**.
//   - `/track` بقى بياخد `doc` اختيارية (`'INVOICE'` افتراضيًا · `'AWB'`):
//     🔴 **`type` لسه معناه الماكينة (S1/S2)** — هي اللي بتحكم التاج
//     (`Printed(S1)`) والميتافيلد (`printing_time_s1`) والحالة والتحوّل.
//     `doc` بتحكم **قيمة `type` في D1 بس**. الخلط بينهم بيكتب تاج
//     `Printed(AWB)` وميتافيلد `printing_time_awb` — الاتنين **مابيفشلوش**،
//     و`isPrinted` بيفضل false للأبد وأداة التغليف ماتشوفش وقت طباعة.
//   - `GUARD_KEYS` بقى فيه `bostaUpdated` — إقرار «عدّلت الشحنة على بوسطة»
//     في بوابة المراجعة. ⚠️ القايمة بيضا: مفتاح مش فيها **بيتسقط في صمت**.
//   - `handleLogs` بقى بيشمل `AWB` مع `S1`/`S2` — عدّاد «مرات الطباعة»
//     وحارس الفاتورة اللاغية لازم يشوفوا طباعة البوليصة زي طباعة الفاتورة.
//   - `total` في `/orders` بقى من `currentTotalPriceSet` (بعد التعديلات
//     والمرتجعات) بدل `totalPriceSet` — لأنه بيتقارن بـ `cod` بتاع بوسطة.
//     القيمة الأصلية بترجع جنبه في `totalOriginal`. (قرار أحمد 07-09-2026)
//   - `diag` بقى بيفحص بوسطة: المفتاح · البحث (v2) · البوليصة المفردة (v1) ·
//     **و`mass-awb` بالمفتاح الخام** — ده كان سؤال مفتوح، وبقى بند على الشاشة.
//   - قيمتا `type` جديدتان في D1 تحت `order_printer`: **`AWB`** و**`not_found`**.
//     لازم يتسجّلوا في `ecommoda-constants` §7 — تفاصيل في `CLAUDE.md`.
//   - 🔴 `shapeLookupOrder` (v2.4.0) أخد `channel` و`zoneKnown` و
//     `currentTotalPriceSet` — الصف ده **بيدّعي إنه مطابق لصف `/orders`
//     بالحرف** وبيعدّي على نفس بوابة الواجهة، فغياب `channel` كان معناه إن
//     أوردر بوسطة في كارت إعادة الطباعة يتطبعله **فاتورة بدل بوليصة**.
//
// CHANGES (v2.4.0):
//   - 🔴 `POST /lookup` — أوردر **واحد** بعينه (بالـ id أو بالاسم) مهما كانت
//     حالته، بنفس شكل صف `/orders` بالظبط. السبب: `/orders` بيفلتر على
//     `Confirmed`/`Confirmed + Edit`/`Confirmed + RETURN`/`Confirmed + EXCHANGE`
//     بحكم تعريفه، فأوردر **اتطبع خلاص** (حالته `Ready` وهو مستني التغليف)
//     مالوش أي طريقة يوصل للواجهة — يعني **إعادة طباعة فاتورة مستحيلة** من
//     غير ما حد يرجّع الحالة يدوي، وده تلويث للتاريخ + الأوردر بيختفي من
//     طابور التغليف طول ما حالته مرجّعة. (قرار أحمد 06-09-2026)
//     ⚠️ **قراءة بحتة** — صفر ميوتيشن وصفر صف D1. الكتابة كلها لسه في `/track`.
//   - 🔴 `/invoice` بقى بياخد `type` **اختياري وصريح** (`S1`/`S2`). السبب لغم
//     حقيقي: القاعدة الافتراضية بتقرا النوع من `status_2_r_e ∈ {Confirmed +
//     RETURN, Confirmed + EXCHANGE}` بس — فأوردر S2 حالته **`Ready`** بيتقري
//     `S1`. والنوع ده **مش تسمية**: هو اللي بيختار بنود الفاتورة نفسها
//     (`fulfillableQuantity` مقابل `currentQuantity`)، وبعدين الواجهة بتبعت
//     نفس النوع لـ `/track` اللي بيكتب على ماكينة **S1** — و`Shipped → Ready`
//     تحوّل **مسموح**، يعني كتابة صامتة على أوردر خرج من المخزن.
//     اللغم ده مكانش قابل للوصول قبل كده (`/invoice` عمره ما اتنادى على أوردر
//     `Ready`) — بيولّع مع إعادة الطباعة بالظبط. الافتراضي **ما اتغيّرش**:
//     من غير `type` السلوك حرفيًا زي v2.3.0، فمسار الطابور صفر تغيير.
//   - ⚠️ `MIN_WORKER_VERSION` في **الأداة المستقلة** فضلت `2.3.0` عن قصد —
//     الواجهة المستقلة مش بتنادي `/lookup` ومش بتبعت `type`، فترفيع الحد
//     الأدنى هناك كان هيولّع تحذير كاذب على أي rollback مشروع (Standards #29).
//     الهب هو اللي بيرفع `printer.min` لـ `2.4.0` لأنه هو المعتمد فعلاً.
//
// CHANGES (v2.3.0):
//   - 🔴 حارس «الفاتورة اللاغية» — الواجهة محتاجة تعرف إن أوردر راجع للطابور
//     (`Confirmed + Edit` أو `Confirmed`) سبق طباعته، عشان تطلب من الموظف
//     يقطّع الورقة القديمة قبل ما يطبع الجديدة. `/orders` بقى بيرجّع:
//       `printingTimeS1` — `custom.printing_time_s1` (آخر طباعة، بتتدهس كل مرة)
//       `packingTimeS1`  — `custom.s1_packing_date_time` (الفاتورة جوّه طرد متغلّف)
//     الاتنين **لأوردرات S1 بس** — قيمة S1 قديمة على أوردر معروض كـ S2 كانت
//     هتولّع تحذير كاذب. (قرار أحمد 06-09-2026)
//   - `/track` بقى بياخد `guard` اختياري (كائن مسطّح، مفاتيح بيضا) وبيحطه في
//     `extra.guard` بتاع صف الطباعة — إقرار الموظف بقطع الفاتورة لازم يتسجّل،
//     من غير `type` جديد في D1 (`ecommoda-constants` §7 ما اتغيّرتش).
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
const WORKER_VERSION = '2.5.0';

const DATE_FROM   = '2026-04-01';

// §CONSTANTS::zone — `ecommoda-order-lifecycle` → `references/zone-routing.md`.
// ⚠️ النصوص حرفية: `Cairo+Giza` بـ `+` والباقي بـ `_`. حرف واحد مختلف =
//    صفر صفوف من غير أي error.
const ZONE = {
  CAIRO_GIZA: 'Cairo+Giza',
  OTHER:      'Other_Regions',   // ← بوسطة
  SHOWROOM:   'Show_Room',
  BLANK:      'BLANK',           // ← «القرار لسه ما اتخدش» — مش زون
};

// القناة اللي بتحدد **إيه اللي بيتطبع**. `null` معناه «مش عارفين» — والأداة
// وقتها **بتعرض الصف وبتقفل الطباعة عليه**، مابتخمّنش. الزون قرار توجيه مش
// جغرافيا (١٨٪ من عناوين القاهرة/الجيزة بتروح بوسطة)، فالاشتقاق من العنوان
// ممنوع صراحةً — قاعدة ١٦ في اللايف سايكل.
const ZONE_CHANNEL = {
  [ZONE.CAIRO_GIZA]: 'invoice',   // فاتورة شوبيفاي · مناديبنا
  [ZONE.SHOWROOM]:   'invoice',   // فاتورة شوبيفاي · استلام من المعرض
  [ZONE.OTHER]:      'awb',       // بوليصة بوسطة — ومفيش فاتورة (قرار أحمد 07-09-2026)
};

// السلوك القديم بالحرف — `/orders` بيرجع عليه لما `allZones` مش مبعوتة.
// ⚠️ متشيلهوش: `Order-Printer/index.html` المستقلة **مجمّدة** على القناتين
//    دول بقرار، وهي بتنادي نفس الـ endpoint.
const ZONE_FILTER = [ZONE.CAIRO_GIZA, ZONE.SHOWROOM];

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

// §CONSTANTS::S2 sets — التلاتة **مش مترادفات**، وكل واحدة ليها سؤال مختلف:
//
//   S2_CONFIRMED_VALUES — «الأوردر في طابور الطباعة كـ S2؟»
//                         دي القاعدة الافتراضية في `/invoice` من قبل v2.4.0،
//                         و**ما اتغيّرتش** — أي تعديل عليها بيغيّر سلوك مسار
//                         الطابور القائم في صمت.
//   S2_PRINTABLE_VALUES — «الدورة S2 لسه في المخزن؟» = القايمة اللي فوق +
//                         `Ready` (اتطبع ومستني التغليف). دي اللي `/lookup`
//                         بيحدد بيها النوع، لأن إعادة الطباعة بالتعريف على
//                         أوردر **عدّى** مرحلة الطباعة. `Shipped`/`In-Return`/
//                         `Returned` **مستبعدين**: الدورة خرجت من المخزن خلاص.
//   S2_ALL_VALUES       — «الأوردر دخل ماكينة S2 أصلاً؟» — للتحقق من `type`
//                         الصريح الجاي من العميل، مش أكتر.
const S2_CONFIRMED_VALUES = [S2_STATUS.CONFIRMED_RETURN, S2_STATUS.CONFIRMED_EXCHANGE];
const S2_PRINTABLE_VALUES = [...S2_CONFIRMED_VALUES, S2_STATUS.READY];
const S2_ALL_VALUES       = Object.values(S2_STATUS);

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
  bosta:   ['BOSTA_API_KEY'],
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
// §BOSTA — البحث + البوليصة (AWB)
// ══════════════════════════════════════════════════════════════
//
// ⚠️ الأداة دي بتنادي **إصدارين مختلفين** من API بوسطة — ده مقصود مش سهو،
//    ومتحقَّق منه حيًا على حساب EcomModa (05-09-2026):
//      البحث           → POST /api/v2/deliveries/search      ✅
//      البوليصة المفردة → GET  /api/v1/deliveries/awb/{_id}    ✅ (v2 بيرجّع 404)
//      البوليصة المجمّعة → POST /api/v2/deliveries/mass-awb     ✅ (v1 بيرجّع 404)
//    والقيمة المطلوبة هي الـ `_id` الداخلي — رقم التتبع **بيترفض بـ 400**.
//
// 🔴 تلات فروق بين المفرد والمجمّع، كل واحد فيهم بيكسر الكود لو اتنسي:
//    | | المفرد | المجمّع |
//    | النسخة       | v1              | **v2**                    |
//    | الفعل        | GET · id في المسار | **POST** · ids في الـ body |
//    | مكان الـ b64 | `data.data`     | **`data`** مباشرةً         |
//
// ⚠️ `ids` في المجمّع **نص مفصول بفواصل** — مصفوفة بترجّع 500
//    `ids.split is not a function`.
const BOSTA_BASE_V1 = 'https://app.bosta.co/api/v1';
const BOSTA_BASE_V2 = 'https://app.bosta.co/api/v2';

// ⚠️ `state.value` بترجّع "Delivered" للكودين **45 و46** — الاعتماد عليها
//    بيخلّي المرتجع يتحسب تسليم. المصدر الوحيد هو `STATE_MAP[state.code]`.
//    (`bosta-api-helper` Step 3 — أعلى مصدر للفشل الصامت في API بوسطة)
const STATE_MAP = {
   10: 'Pickup requested',          11: 'Waiting for route',
   20: 'Route Assigned',            21: 'Picked up from business',
   22: 'Picking up from consignee', 23: 'Picked up from consignee',
   24: 'Received at warehouse',     25: 'Fulfilled',
   30: 'In transit between Hubs',   40: 'Picking up',
   41: 'Picked up',                 45: 'Delivered',
   46: 'Returned to business',      47: 'Exception',
   48: 'Terminated',                49: 'Canceled',
   60: 'Returned to stock',        100: 'Lost',
  101: 'Damaged',                  102: 'Investigation',
  103: 'Awaiting your action',     104: 'Archived',
  105: 'On hold',
};

// §BOSTA::AWB_BLOCKED_STATES
// 🔴 دي **مرآة محلية لحارس بوسطة، مش سياسة أشد منه.** بوسطة نفسها مابتطلّعش
//    بوليصة للحالات دي (أكّدها أحمد 07-09-2026) — بس في **الوضع المجمّع**
//    بترفضها **في صمت**: HTTP 200 و«Done successfully» وصفحات أقل من الـ IDs،
//    من غير أي إشارة إن حاجة اتشالت (`BOSTA-AWB-API.md` §3.1).
//    الغرض الوحيد من القايمة دي: نحوّل السقوط الصامت ده لصف **باسمه** على
//    الشاشة، والبيانات جاية مجانًا في نفس نداء البحث.
// ⚠️ **مقصود إنها ضيّقة.** لو قايمتنا أوسع من بوسطة نبقى منعنا طباعة مشروعة؛
//    لو أضيق، حارس عدّ الصفحات بيمسك الباقي. الأوسع خطر، الأضيق مغطّى.
const AWB_BLOCKED_STATES = {
   46: 'راجعة للتاجر',
   48: 'منتهية',
   49: 'ملغية',
   60: 'رجعت للمخزون',
  100: 'ضايعة',
  104: 'مؤرشفة',
};

// نوع الشحنة الصادرة. ⚠️ `/deliveries/search` بترجّع `Send` (بحرف كبير واحد)
// بينما الويبهوك بيبعت `SEND` — **قيمتان مختلفتان لنفس المعنى**، فالمقارنة
// بتتعمل بلا حساسية لحالة الحروف. (`bosta-api-helper` — فخ نوع type التاني)
const SEND_TYPES = new Set(['send', 'fxf_send']);
function isSendDelivery(t) { return SEND_TYPES.has(String(t || '').trim().toLowerCase()); }

// ⚠️ `type: 'SEND'` في جسم البحث **بيتجاهله بوسطة في صمت** ويرجّع كل الأنواع.
//    الفلترة client-side هي الطريقة الوحيدة (`bosta-api-helper` Step 2).

// حجم شريحة البحث. البحث بيقبل مراجع متعددة بفواصل، بس `limit` بيقص **في
// صمت**: أوردر الاستبدال عنده شحنتين، فـ ٢٥ مرجع ممكن يبقوا ٥٠ صف ويتقصّوا
// عند السقف. الشرائح بتشيل التخمين خالص — ٣ نداءات لدفعة ٢٥ مقابل واحد.
const BOSTA_SEARCH_CHUNK = 10;
const BOSTA_SEARCH_LIMIT = 50;

// حجم الـ PDF الحقيقي من طول الـ base64 — عشان نعرض بايتات مش عدد حروف
function b64Bytes(b64) {
  if (!b64) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

// §BOSTA::countPdfPages
// 🔴 الحارس الوحيد ضد أخطر فخ في `mass-awb`: IDs غلط أو غير مؤهلة **بتتشال
//    في صمت** والرد بيقول success. من غير العدّ ده، ٢٥ أوردر بيرجعوا ٢٤
//    بوليصة و«تم» — وكرتونة بتخرج من المخزن من غير ملصق ومحدش بياخد باله.
function countPdfPages(b64) {
  try {
    const bin = atob(b64);
    return (bin.match(/\/Type\s*\/Page[^s]/g) || []).length;
  } catch { return null; }   // null = «ما قدرناش نعدّ» — مش صفر
}

// §BOSTA::bostaFetch
// ⚠️ الفشل هنا **لازم يبان**. `if (!res.ok) continue` أو catch فاضي بيحوّل
//    «المفتاح غلط / بوسطة واقعة» إلى «الشحنة غير موجودة» — ودي رسالة كاذبة
//    بتخلّي الموظف يفتكر إن الأوردر ما اترفعش، فيروح يرفعه تاني.
async function bostaFetch(env, url, opts = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': env.BOSTA_API_KEY,   // ← مفتاح خام، **بدون** "Bearer"
        ...(opts.headers || {}),
      },
    });
  } catch (e) {
    throw new Error(`تعذّر الوصول لبوسطة: ${e.message}`);
  }

  const text = await resp.text();
  if (!resp.ok) {
    const hint =
      (resp.status === 401 || resp.status === 403) ? ' — غالبًا BOSTA_API_KEY غلط أو منتهي' :
      (resp.status === 404) ? ' — المسار مش موجود على نسخة الـ API دي' : '';
    throw new Error(`بوسطة رجّعت HTTP ${resp.status}${hint}: ${text.slice(0, 180)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`رد بوسطة مش JSON صالح: ${text.slice(0, 180)}`); }
}

// بوسطة بترجّع الشحنات بأربع أشكال مختلفة — لازم يتعاملوا كلهم
function extractDeliveries(raw) {
  if (Array.isArray(raw?.data?.deliveries)) return raw.data.deliveries;
  if (Array.isArray(raw?.data))             return raw.data;
  if (Array.isArray(raw?.deliveries))       return raw.deliveries;
  if (raw?.trackingNumber)                  return [raw];
  return [];
}

// §BOSTA::shapeDelivery
// ⚠️ `city` و`zone` و`district` و`type` **أوبجكتات مش نصوص** — قراءتها
//    مباشرةً بتطبع `[object Object]` على الشاشة.
function shapeDelivery(d) {
  const stateCode = d.state?.code;
  const first     = d.receiver?.firstName || '';
  const last      = d.receiver?.lastName  || '';
  return {
    deliveryId:        d._id || null,
    trackingNumber:    d.trackingNumber || null,
    businessReference: d.businessReference || null,
    type:              d.type?.value || d.type || null,
    stateCode:         stateCode ?? null,
    stateName:         STATE_MAP[stateCode] || d.state?.value || 'غير معروف',
    cod:               d.cod ?? null,
    receiverName:      (d.receiver?.fullName || `${first} ${last}`).trim() || null,
    city:              d.dropOffAddress?.city?.name || null,
    zone:              d.dropOffAddress?.zone?.name || null,
    attempts:          d.numberOfAttempts ?? null,
    createdAt:         d.createdAt || null,
  };
}

// §BOSTA::cleanRef — «#53400» و«53400» نفس المرجع
function cleanRef(x) { return String(x ?? '').trim().replace(/^#/, ''); }

// §BOSTA::bostaSearchRefs
// بحث بمراجع الأوردرات على شرائح.
// ⚠️ `businessReferences` **بالجمع** بيتجاهله بوسطة في صمت ويرجّع **كل**
//    الشحنات لحد الـ limit (اختبار حي: ٥ مراجع → ٥٠ شحنة). المفرد بـ CSV
//    هو الشكل الصح الوحيد.
// 🔴 والمطابقة النهائية بتتعمل **عندنا بالتساوي التام**: رد بوسطة مش عقد
//    مضمون إنه مطابقة تامة، ومطابقة جزئية معناها بوليصة أوردر تاني.
async function bostaSearchRefs(env, refs) {
  const wanted = [...new Set(refs.map(cleanRef).filter(Boolean))];
  const byRef  = new Map(wanted.map(r => [r, []]));
  let truncated = false;

  for (let i = 0; i < wanted.length; i += BOSTA_SEARCH_CHUNK) {
    const chunk = wanted.slice(i, i + BOSTA_SEARCH_CHUNK);
    const raw = await bostaFetch(env, `${BOSTA_BASE_V2}/deliveries/search`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessReference: chunk.map(r => `#${r}`).join(','),
        limit: BOSTA_SEARCH_LIMIT,
        page:  1,
      }),
    });
    const rows = extractDeliveries(raw);
    // الرد وصل السقف = ممكن يكون فيه أكتر ما اتعرضش. مش بنخمّن — بنقولها.
    if (rows.length >= BOSTA_SEARCH_LIMIT) truncated = true;

    for (const row of rows) {
      const shaped = shapeDelivery(row);
      const key    = cleanRef(shaped.businessReference);
      if (byRef.has(key)) byRef.get(key).push(shaped);   // ← المطابقة التامة
    }
  }
  return { byRef, truncated };
}

// §BOSTA::classifyForPrint
// بتقرر: الأوردر ده تنفع تتطبع بوليصته دلوقتي ولا لأ — **ومن غير أي نداء
// زيادة**، كل البيانات جاية من نداء البحث.
// بترجّع { ok, selected, reason, deliveries }.
function classifyForPrint(deliveries) {
  if (!deliveries.length) {
    return { ok: false, selected: null, reason: 'not_found', deliveries };
  }

  const sends   = deliveries.filter(d => isSendDelivery(d.type));
  const pool    = sends.length ? sends : deliveries;   // مالقيناش Send؟ ما نقولش «مفيش شحنة»
  const live    = pool.filter(d => !(d.stateCode in AWB_BLOCKED_STATES));
  const blocked = pool.filter(d =>   d.stateCode in AWB_BLOCKED_STATES);

  if (!live.length) {
    const names = [...new Set(blocked.map(d => AWB_BLOCKED_STATES[d.stateCode]))].join(' · ');
    return { ok: false, selected: null, reason: 'blocked_state', blockedAs: names, deliveries };
  }

  // 🔴 أكتر من شحنة صادرة حيّة = **مابنخمّنش**. ملصق غلط على كرتونة أسوأ من
  //    صف مستني قرار. بيطلع من الدفعة وبيتحدد بإيد الموظف.
  if (live.length > 1) {
    return { ok: false, selected: null, reason: 'ambiguous', deliveries };
  }

  // مالقيناش أي شحنة نوعها Send — نمشي بالوحيدة الحيّة، بس بعلامة.
  const note = sends.length ? null : 'no_send_type';
  return { ok: true, selected: live[0], reason: null, note, deliveries };
}

// §BOSTA::bostaFetchAWB — بوليصة واحدة
// GET /api/v1/deliveries/awb/{_id} → { data: { data: "<base64>", latestAWBPrintDate } }
async function bostaFetchAWB(env, deliveryId) {
  const raw = await bostaFetch(env, `${BOSTA_BASE_V1}/deliveries/awb/${encodeURIComponent(deliveryId)}`);
  const b64 = typeof raw?.data === 'string' ? raw.data : (raw?.data?.data || '');
  if (!b64) throw new Error('بوسطة ردّت بنجاح بس من غير محتوى بوليصة');
  return {
    pdfBase64:          b64,
    // "JVBER" = ترميز base64 لـ "%PDF" — إثبات إن اللي رجع ملف مش نص خطأ
    looksLikePdf:       b64.startsWith('JVBER'),
    latestAWBPrintDate: raw?.data?.latestAWBPrintDate || null,
  };
}

// §BOSTA::bostaFetchMassAWB — بوليصة واحدة مدموجة لكل الـ IDs
// POST /api/v2/deliveries/mass-awb → { data: "<base64>" }  ← `data` مباشرةً
// ⚠️ `lang` و`blockUnAutoAssigned` اختياريين، والقياس أثبت إن حذفهم بيدي
//    نتيجة مطابقة بايت ببايت — فمابنبعتهمش.
async function bostaFetchMassAWB(env, deliveryIds) {
  const raw = await bostaFetch(env, `${BOSTA_BASE_V2}/deliveries/mass-awb`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids: deliveryIds.join(',') }),   // ← نص مش مصفوفة
  });
  const b64 = typeof raw?.data === 'string' ? raw.data : (raw?.data?.data || '');
  if (!b64) throw new Error('بوسطة ردّت بنجاح بس من غير محتوى بوليصة');
  return {
    pdfBase64:          b64,
    looksLikePdf:       b64.startsWith('JVBER'),
    latestAWBPrintDate: raw?.latestAWBPrintDate || raw?.data?.latestAWBPrintDate || null,
  };
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
          totalPriceSet        { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          customer { firstName lastName }
          manual_status: metafield(namespace: "custom", key: "manual_status") { value }
          status_2_r_e:  metafield(namespace: "custom", key: "status_2_r_e")  { value }
          zone:          metafield(namespace: "custom", key: "zone")           { value }
          printing_time_s1:     metafield(namespace: "custom", key: "printing_time_s1")     { value }
          s1_packing_date_time: metafield(namespace: "custom", key: "s1_packing_date_time") { value }
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
  const body = await request.json().catch(() => ({}));

  // 🔴 `allZones` — الافتراضي **false**، يعني السلوك القديم بالحرف.
  //    `Order-Printer/index.html` المستقلة مجمّدة على قاهرة+جيزة بقرار
  //    (أحمد 07-09-2026) وبتنادي نفس الـ endpoint من غير الباراميتر ده،
  //    فلازم يفضل بيشوف نفس القايمة بالظبط. الهب بس هو اللي بيبعت true.
  const allZones = body.allZones === true;

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
  // في وضع `allZones` مفيش استبعاد أصلاً: الصف بيظهر، والقناة هي اللي
  // بتقرر يتطبع إيه — و`null` معناها الطباعة مقفولة برسالة، مش إخفاء.
  const zoneFiltered = allZones ? merged : merged.filter(o => ZONE_FILTER.includes(o.zone?.value));
  const zoneExcluded = merged.length - zoneFiltered.length;

  const allOrders = zoneFiltered.map(o => ({
    id:        o.id,
    orderId:   o.legacyResourceId || String(o.id).split('/').pop(),
    name:      o.name,
    createdAt: o.createdAt,
    customer:  [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || '-',
    type:      o.type,
    status:    o.status,
    // 🔴 حارس الفاتورة اللاغية — **S1 بس**. `printing_time_s1` بيفضل على
    //    الأوردر بعد أي طباعة S1، فلو عرضناه على صف S2 كان هيولّع تحذير
    //    «فاتورة لاغية» على أوردر استبدال ما اتطبعش أصلاً.
    //    ⚠️ القيمة دي **آخر** طباعة مش أول واحدة — الأداة بتدهسها في كل
    //    طباعة (`known-gaps` G-4). ودي بالظبط اللي الحارس محتاجها.
    printingTimeS1: o.type === 'S1' ? (o.printing_time_s1?.value     || null) : null,
    packingTimeS1:  o.type === 'S1' ? (o.s1_packing_date_time?.value || null) : null,
    // 🔴 `total` من **`currentTotalPriceSet`** (قرار أحمد 07-09-2026) — أي
    //    تعديل أو مرتجع على الأوردر بينعكس فيه، والرقم ده بيتقارن بـ `cod`
    //    بتاع شحنة بوسطة في بوابة المراجعة. `totalPriceSet` بيفضل جنبه
    //    باسمه عشان المقارنة نفسها تبقى قابلة للمراجعة.
    total:         parseFloat(o.currentTotalPriceSet?.shopMoney?.amount
                              ?? o.totalPriceSet?.shopMoney?.amount ?? 0),
    totalOriginal: parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),

    // §ZONE — القناة. القيمة الخام بترجع زي ما هي **حتى لو مش معروفة**:
    // ٣٣ قيمة غير صالحة موجودة فعلاً في تعريف الميتافيلد، والقاعدة إن
    // المجهول **يتعلّم ويفضل مكانه**، ما يتلمّش لأكبر خانة (قاعدة ١٣).
    zone:      o.zone?.value || null,
    zoneKnown: !!o.zone?.value && Object.values(ZONE).includes(o.zone.value),
    channel:   ZONE_CHANNEL[o.zone?.value] || null,   // 'invoice' · 'awb' · null

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
    allZones,
    fetchedAt:    new Date().toISOString(),
    source:       'shopify',
  }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §LOOKUP — أوردر واحد بعينه، مهما كانت حالته (v2.4.0)
// ══════════════════════════════════════════════════════════════
//
// 🔴 **ليه المسار ده موجود:** `/orders` بيفلتر على أربع حالات «مؤكَّد» بحكم
//    تعريفه — فأوردر **اتطبع خلاص** (حالته `Ready` وهو مستني التغليف) مستحيل
//    يوصل للواجهة. النتيجة اللي كانت في المخزن: الورقة تضيع أو تتقطع أو
//    الطابعة تطلعها باهتة، ومفيش أي طريقة تطبعها تاني غير إن حد يرجّع حالة
//    الأوردر يدوي لـ `Confirmed + Edit` — وده بيكتب في `metafields_change` إن
//    العميل عدّل الأوردر (**كذب في التاريخ** بيغذّي حارس الفاتورة اللاغية
//    بعد كده)، وبيخلّي الأوردر **يختفي من طابور التغليف** طول ما الحالة
//    مرجّعة، فلو الموظف نسي يطبع الأوردر بيتوه من الطابورين.
//
// ⚠️ **قراءة بحتة** — صفر ميوتيشن، صفر صف D1، صفر تغيير حالة. الكتابة كلها
//    لسه في `/track` لوحده.
//
// ⚠️ **`ZONE_FILTER` مابيتطبقش هنا** — ده استعلام عن أوردر الموظف كاتب رقمه
//    بنفسه، مش طابور بيتبني له. بس الرد بيرجّع `zoneExcluded` لأن «الأوردر مش
//    ظاهر في الطابور» سببه الحقيقي غالبًا المنطقة (أو غيابها).

const LOOKUP_FIELDS = `
  id legacyResourceId name createdAt tags
  totalPriceSet        { shopMoney { amount } }
  currentTotalPriceSet { shopMoney { amount } }
  customer { firstName lastName }
  manual_status: metafield(namespace: "custom", key: "manual_status") { value }
  status_2_r_e:  metafield(namespace: "custom", key: "status_2_r_e")  { value }
  zone:          metafield(namespace: "custom", key: "zone")           { value }
  printing_time_s1:     metafield(namespace: "custom", key: "printing_time_s1")     { value }
  printing_time_s2:     metafield(namespace: "custom", key: "printing_time_s2")     { value }
  s1_packing_date_time: metafield(namespace: "custom", key: "s1_packing_date_time") { value }
  s2_packing_date_time: metafield(namespace: "custom", key: "s2_packing_date_time") { value }
`;

const LOOKUP_BY_ID_QUERY = `
  query LookupOrderById($id: ID!) {
    order(id: $id) { ${LOOKUP_FIELDS} }
  }
`;

const LOOKUP_BY_NAME_QUERY = `
  query LookupOrderByName($q: String!) {
    orders(first: 10, query: $q) { edges { node { ${LOOKUP_FIELDS} } } }
  }
`;

// ─── §LOOKUP::shapeLookupOrder ───
//
// الشكل **مطابق لصف `/orders`** بالحرف (نفس أسماء المفاتيح ونفس بوابة
// `printingTimeS1`/`packingTimeS1` على S1) — عشان الواجهة تعدّي الصف ده على
// نفس البوابة (`§PREPRINT-GATE`) ونفس `executePrint` من غير أي فرع تاني.
// **صف بشكل مختلف = فرع تاني في الواجهة = درس R1 من أول وجديد.**
//
// ⚠️ الزيادات الأربعة (`s1Status` · `s2Status` · `printingTimeS2` ·
//    `packingTimeS2`) **إضافة مش تعديل** — `/orders` مابيرجّعهمش، والواجهة
//    بتقراهم بس على صف إعادة الطباعة.
//
// 🔴 وأي حقل جديد بيتضاف لصف `/orders` **لازم يتضاف هنا في نفس التمريرة**.
//    ده حصل فعلاً: `/orders` أخد `channel`/`zoneKnown` في v2.5.0، والصف ده
//    فضل من غيرهم لحظة — فأوردر بوسطة في كارت إعادة الطباعة كان هيتقري
//    «بلا قناة» ويتطبعله **فاتورة بدل بوليصة**، من غير أي خطأ.
function shapeLookupOrder(node) {
  const s1Status = node.manual_status?.value || null;
  const s2Status = node.status_2_r_e?.value  || null;

  // 🔴 النوع من `S2_PRINTABLE_VALUES` مش من `S2_CONFIRMED_VALUES` — أوردر
  //    إعادة الطباعة بالتعريف **عدّى** مرحلة الطباعة، فحالته `Ready` مش
  //    `Confirmed + …`. القايمة المؤكَّدة كانت هترجّعه `S1` وتطبع بنود غلط.
  const type = S2_PRINTABLE_VALUES.includes(s2Status) ? 'S2' : 'S1';
  const tags = node.tags || [];

  return {
    id:        node.id,
    orderId:   node.legacyResourceId || String(node.id).split('/').pop(),
    name:      node.name,
    createdAt: node.createdAt,
    customer:  [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(' ') || '-',
    type,
    status:    type === 'S2' ? s2Status : s1Status,
    // الحالتان الخام — الواجهة بتعرضهم عشان الموظف يفهم ليه الأوردر مش في
    // الطابور، بدل ما يفتكر الأداة عطلانة.
    s1Status,
    s2Status,
    printingTimeS1: type === 'S1' ? (node.printing_time_s1?.value     || null) : null,
    packingTimeS1:  type === 'S1' ? (node.s1_packing_date_time?.value || null) : null,
    printingTimeS2: type === 'S2' ? (node.printing_time_s2?.value     || null) : null,
    packingTimeS2:  type === 'S2' ? (node.s2_packing_date_time?.value || null) : null,
    // 🔴 §CHANNEL — **لازم يفضلوا مطابقين لصف `/orders`** (v2.5.0).
    //    الصف ده بيعدّي على نفس بوابة الواجهة ونفس مسار الطباعة، والواجهة
    //    بتقرا `channel` عشان تقرر **إيه اللي بيتطبع**: فاتورة شوبيفاي ولا
    //    بوليصة بوسطة. لو الحقل غاب هنا، `channel` بتبقى `undefined` والصف
    //    بيتقري «بلا قناة» — يعني أوردر بوسطة بيتطبعله **فاتورة بدل بوليصة**
    //    أو بيتقفل بلا سبب. **صفر خطأ في الكونسول** في الحالتين.
    zone:      node.zone?.value || null,
    zoneKnown: !!node.zone?.value && Object.values(ZONE).includes(node.zone.value),
    channel:   ZONE_CHANNEL[node.zone?.value] || null,
    total:         parseFloat(node.currentTotalPriceSet?.shopMoney?.amount
                              ?? node.totalPriceSet?.shopMoney?.amount ?? 0),
    totalOriginal: parseFloat(node.totalPriceSet?.shopMoney?.amount || 0),
    tags,
    isPrinted: tags.includes(`Printed(${type})`),
  };
}

async function handleLookup(request, env) {
  assertEnv(env, 'shopify');
  const body    = await request.json().catch(() => ({}));
  const rawId   = body?.orderId != null ? String(body.orderId).trim() : '';
  const rawName = body?.name    != null ? String(body.name).trim()    : '';
  if (!rawId && !rawName) return json({ error: 'Missing orderId أو name' }, 400, request);

  const token = await getAccessToken(env);
  let node = null;

  if (rawId) {
    const gid  = rawId.startsWith('gid://') ? rawId : `gid://shopify/Order/${rawId}`;
    const data = await shopifyGQL(env, token, LOOKUP_BY_ID_QUERY, { id: gid }, 'lookup_by_id');
    node = data?.data?.order || null;
  } else {
    // 🔴 **المطابقة التامة إلزامية.** فلتر `name:` في شوبيفاي بيطابق بالبادئة،
    //    يعني `#5362` بيرجّع `#53621` كمان (نفس الفخ الموثّق في `journey.html`).
    //    هنا الثمن أغلى بكتير من جدول ناقص: فاتورة **أوردر تاني** بتتطبع
    //    وتتحط في طرد. فالبحث بيرجّع 404 بدل ما يخمّن.
    const clean = rawName.replace('#', '');
    const data  = await shopifyGQL(env, token, LOOKUP_BY_NAME_QUERY, { q: `name:#${clean}` }, 'lookup_by_name');
    node = (data?.data?.orders?.edges || [])
      .map(e => e.node)
      .find(n => String(n.name).replace('#', '') === clean) || null;
  }

  if (!node) {
    return json({ ok: false, error: `الأوردر ${rawName || rawId} غير موجود على شوبيفاي` }, 404, request);
  }

  const order = shapeLookupOrder(node);

  // `undefined`/`null` مش في `ZONE_FILTER` — فالأوردر اللي مالوش منطقة خالص
  // بيتحسب مستبعَد، وده **نفس** سلوك `/orders` بالظبط مش تشديد جديد.
  const zoneExcluded = !ZONE_FILTER.includes(order.zone);
  const inPrintQueue = !zoneExcluded && (
    order.type === 'S2'
      ? S2_CONFIRMED_VALUES.includes(order.s2Status)
      : [S1_STATUS.CONFIRMED, S1_STATUS.CONFIRMED_EDIT].includes(order.s1Status)
  );

  return json({
    ok:           true,
    order,
    inPrintQueue,
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

// ─── §PRINT::resolveInvoiceType (v2.4.0) ───
//
// 🔴 **من غير `requested` السلوك حرفيًا زي v2.3.0** — مسار الطابور صفر تغيير.
//
// ⚠️ اللغم اللي الباراميتر ده اتضاف عشانه: القاعدة الافتراضية بتقرا النوع من
//    `S2_CONFIRMED_VALUES` بس، فأوردر S2 حالته **`Ready`** (اتطبع ومستني
//    التغليف) بيتقري `S1`. والنوع ده **مش تسمية** — هو اللي بيختار بنود
//    الفاتورة نفسها تحت (`fulfillableQuantity` مقابل `currentQuantity`)،
//    والواجهة بتاخد النوع من الرد ده وتبعته لـ `/track`، و`/track` بيكتب على
//    ماكينة **S1** — و`Shipped → Ready` تحوّل **مسموح** في `ALLOWED_TRANSITIONS_S1`،
//    يعني كتابة صامتة على أوردر خرج من المخزن خلاص.
//    اللغم مكانش قابل للوصول قبل v2.4.0 لأن `/invoice` عمره ما اتنادى على
//    أوردر `Ready`. `/lookup` بيفتح المسار ده، فالنوع بقى بيتبعت صريح.
//
// ⚠️ **الصريح بيتحقّق منه.** `type=S2` على أوردر مالوش أي قيمة في ماكينة S2
//    بيترفض برسالة واضحة بدل ما يطبع فاتورة غلط — «ارفض + سجّل، عمرها ما
//    تسمح في صمت» (`ecommoda-order-lifecycle` §1.5).
function resolveInvoiceType(order, requested) {
  const s2 = order.status_2_r_e?.value || null;
  if (!requested) return { type: S2_CONFIRMED_VALUES.includes(s2) ? 'S2' : 'S1' };
  if (requested !== 'S1' && requested !== 'S2') {
    return { error: `type غير صالح: "${requested}" — المسموح S1 أو S2` };
  }
  if (requested === 'S2' && !S2_ALL_VALUES.includes(s2)) {
    return { error: `type=S2 مرفوض للأوردر ${order.name} — الأوردر ده مالوش أي قيمة في ماكينة S2 (custom.status_2_r_e فاضي)` };
  }
  return { type: requested };
}

async function handleInvoice(request, env) {
  assertEnv(env, 'shopify');
  const { orderId, type: requestedType } = await request.json().catch(() => ({}));
  if (!orderId) return json({ error: 'Missing orderId' }, 400, request);

  const token = await getAccessToken(env);

  // shopifyGQL بترمي على أي فشل — مفيش داعي لفحص data.errors هنا تاني
  const data  = await shopifyGQL(env, token, INVOICE_QUERY, { id: orderId }, 'invoice');
  const order = data?.data?.order;
  if (!order) return json({ error: 'Order not found' }, 404, request);

  const resolved = resolveInvoiceType(order, requestedType);
  if (resolved.error) return json({ error: resolved.error }, 400, request);
  const type = resolved.type;
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
// ─── §PRINT::sanitizeGuard ───
// إقرار الموظف بقطع الفاتورة القديمة بيتسجّل في `extra.guard` بتاع صف الطباعة.
// ⚠️ قايمة بيضا مقفولة + قصّ الطول: الجسم جاي من العميل، و`extra` عمود مشترك
//    في جدول `logs` بتاع كل الستاك. أي مفتاح بره القايمة بيتسقط في صمت
//    **عن قصد** — الطباعة عمرها ما تفشل عشان حقل تسجيل.
// ⚠️ إضافة مفتاح للواجهة من غير ما يتضاف هنا = الإقرار **بيتسقط في صمت**:
//    البوابة تشتغل على الشاشة والسجل يقول إن الموظف ما أقرّش بحاجة.
//    `bostaUpdated` = «عدّلت الشحنة على بوسطة» (السؤال التاني في بوابة بوسطة).
const GUARD_KEYS = ['name', 'prevPrintAt', 'prevPackAt', 'cutConfirmed',
                    'bostaUpdated', 'statusAtGate'];
function sanitizeGuard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of GUARD_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string')  { out[k] = v.slice(0, 120); continue; }
  }
  return Object.keys(out).length ? out : null;
}

// ─── §PRINT::sanitizeBosta ───
// بيانات شحنة بوسطة في صف السجل. نفس مبدأ `sanitizeGuard`: قايمة بيضا
// مقفولة وقصّ الطول — `extra` عمود مشترك في جدول `logs` بتاع الستاك كله،
// والجسم جاي من العميل. التسجيل عمره ما يفشّل الطباعة.
const BOSTA_LOG_KEYS = ['deliveryId', 'trackingNumber', 'stateCode', 'stateName',
                        'deliveryType', 'cod', 'pdfBytes', 'batchSize', 'latestAWBPrintDate'];
function sanitizeBosta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of BOSTA_LOG_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, 120); continue; }
  }
  return Object.keys(out).length ? out : null;
}

async function handleTrack(request, env) {
  assertEnv(env, 'shopify');

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400, request);

  const { orderId, orderNumber, type, employee } = body;
  if (!orderId || !orderNumber || !type) {
    return json({ error: 'Missing fields: orderId, orderNumber, type' }, 400, request);
  }
  // 🔴 `type` = **الماكينة** (S1/S2). هي اللي بتحكم التاج والميتافيلد والحالة
  //    وجدول التحوّلات — ومابتتغيّرش بنوع المستند المطبوع.
  if (type !== 'S1' && type !== 'S2') {
    return json({ error: `type غير صالح: "${type}" — المسموح S1 أو S2` }, 400, request);
  }

  // 🔴 `doc` = **المستند** اللي اتطبع. بيحكم **قيمة `type` في D1 بس**.
  //    الخلط بين الاتنين هو الفخ: لو بعتنا 'AWB' مكان الماكينة، `tagOrder`
  //    هتكتب تاج `Printed(AWB)` و`setPrintingTimeMetafield` هتكتب مفتاح
  //    `printing_time_awb` — **الاتنين مابيفشلوش**، و`isPrinted` يفضل false
  //    للأبد وأداة التغليف ماتشوفش وقت طباعة. صفر خطأ في الكونسول.
  const doc = String(body.doc || 'INVOICE').toUpperCase();
  if (doc !== 'INVOICE' && doc !== 'AWB') {
    return json({ error: `doc غير صالح: "${doc}" — المسموح INVOICE أو AWB` }, 400, request);
  }
  if (doc === 'AWB' && type !== 'S1') {
    // طباعة بوسطة **S1 بس** بقرار (أحمد 07-09-2026) — والرفض صريح مش صامت.
    return json({ error: 'طباعة بوليصة بوسطة متاحة لأوردرات S1 بس دلوقتي' }, 400, request);
  }
  const logType = doc === 'AWB' ? 'AWB' : type;
  // كل عملية طباعة مربوطة بموظف — عمود employee كان فاضي في كل الصفوف التاريخية
  if (!employee) {
    return json({ error: 'employee مطلوب — سجّل الدخول أولاً' }, 400, request);
  }

  const guard = sanitizeGuard(body.guard);
  // بيانات الشحنة اللي اتطبعت بوليصتها — للسجل بس، بقايمة بيضا زي `guard`.
  const bosta = doc === 'AWB' ? sanitizeBosta(body.bosta) : null;

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
      type:      logType,          // ← S1 · S2 · AWB
      timestamp: ts,
      employee,
      orderId:   numericId,
      orderName: orderNum,
      notes:     actions.join(' · ') || 'مفيش أي فعل تم',
      extra:     {
        result: { status, actions, warnings, errors, statusBefore, statusLogged },
        ...(doc === 'AWB' ? { doc, machine: type, bosta } : {}),
        ...(guard ? { guard } : {}),
      },
    });
  } catch (e) {
    logged = false; logError = e.message;   // الطباعة حصلت — بس مفيش سجل
  }

  return json({
    ok: status !== 'error',
    status, actions, warnings, errors,
    orderId:     numericId,
    orderNumber: `#${orderNum}`,
    type,                 // الماكينة — الواجهة بتقابل بيها الأوردر
    doc,                  // المستند — عشان نافذة النتيجة تقول اتطبع إيه
    statusBefore,
    logged, logError,
  }, 200, request);
}

// ─── §PRINT::handleBostaLookup ───
// تحويل أرقام أوردرات → شحنات بوسطة. **نداء واحد بيجيب كل اللي البوابة
// محتاجاه** (المعرّف · الحالة · النوع · التحصيل)، وبعده مفيش أي نداء بوسطة
// تاني قبل ما الموظف يقرّ في البوابة.
//
// 🔴 الأداة دي **بتقرا من بوسطة بس** — مفيش أي كتابة على بوسطة ولا شوبيفاي.
//    الكتابة الوحيدة صف `not_found` في D1، وهو الأثر الوحيد الموجود لتخطّي
//    **بوابة رفع إلزامية**: أوردر `Other_Regions` مالوش شحنة معناه إنه
//    ما اترفعش على بوسطة، والخطوة دي إلزامية قبل الطباعة
//    (`ecommoda-order-lifecycle` → `zone-routing.md` §2.2).
async function handleBostaLookup(request, env) {
  assertEnv(env, 'bosta');

  const body     = await request.json().catch(() => ({}));
  const orders   = Array.isArray(body.orders) ? body.orders : [];
  const employee = body.employee || null;
  if (!orders.length) return json({ ok: false, error: 'orders مطلوبة' }, 400, request);

  const { byRef, truncated } = await bostaSearchRefs(env, orders.map(o => o.name));

  const results = [];
  const notFound = [];

  for (const o of orders) {
    const ref  = cleanRef(o.name);
    const list = byRef.get(ref) || [];
    const cls  = classifyForPrint(list);

    // فرق التحصيل — مش حارس تاني، ده **مُشغِّل** لنفس بوابة المراجعة.
    // قيمته إنه بيمسك الحالة اللي **الحالة نفسها مابتقولش عنها حاجة**:
    // أوردر لسه `Confirmed` عادي والرقم على الملصق مختلف عن قيمة الأوردر.
    // ⚠️ `cod` = إجمالي الأوردر **+ الشحن** (أكّده أحمد 07-09-2026)، و`total`
    //    جاي من `currentTotalPriceSet` (شامل الشحن وبعد أي تعديل) — فالمقارنة
    //    مباشرة. و`null` معناها «مش عارفين» → **مفيش تحذير**: حارس بيولّع على
    //    بيانات ناقصة بيتشال بعد أسبوع.
    let codMismatch = null;
    const cod   = cls.selected ? cls.selected.cod : null;
    const total = typeof o.total === 'number' ? o.total : null;
    if (cod !== null && cod !== undefined && total !== null) {
      const diff = Math.round((Number(cod) - total) * 100) / 100;
      if (Math.abs(diff) >= 0.01) codMismatch = { cod: Number(cod), total, diff };
    }

    if (cls.reason === 'not_found') notFound.push(o);

    results.push({
      id:          o.id,
      name:        o.name,
      found:       list.length > 0,
      ok:          cls.ok,
      reason:      cls.reason,          // null · not_found · blocked_state · ambiguous
      blockedAs:   cls.blockedAs || null,
      note:        cls.note || null,    // no_send_type
      selected:    cls.selected,
      deliveries:  cls.deliveries,
      codMismatch,
    });
  }

  // صفوف `not_found` — بتتكتب **مرة واحدة لكل محاولة طباعة** (الواجهة
  // بتنادي الـ lookup وقت الضغط على «طباعة المحدد»، مش عند كل تحديث للطابور).
  // ⚠️ فشل D1 هنا **مايوقّفش** الطباعة — بيرجع في الرد وخلاص.
  let logged = true, logError = null;
  for (const o of notFound) {
    try {
      await writeLog(env.DB, {
        tool:      TOOL_NAME,
        type:      'not_found',
        employee,
        orderName: cleanRef(o.name),
        notes:     'مفيش شحنة على بوسطة بالرقم ده — الأوردر ما اترفعش (أو اترفع بمرجع مختلف)',
        extra:     { result: 'warning', doc: 'AWB', zone: ZONE.OTHER },
      });
    } catch (e) { logged = false; logError = e.message; }
  }

  return json({
    ok: true,
    results,
    // وصلنا سقف البحث في شريحة = ممكن يكون فيه شحنات ما ظهرتش. مش بنخمّن.
    truncated,
    searchLimit: BOSTA_SEARCH_LIMIT,
    logged, logError,
  }, 200, request);
}

// ─── §PRINT::handleBostaAWB ───
// جلب البوليصة/البوالص. **قراءة بحتة** — مفيش D1 ومفيش شوبيفاي هنا؛
// التسجيل كله في `/track` زي مسار الفاتورة بالظبط.
//
// 🔴 حارس عدّ الصفحات هو **الحاجة الوحيدة** اللي بتمسك أخطر فخ في `mass-awb`:
//    ID غير مؤهل بيتشال في صمت والرد بيقول «Done successfully». من غيره ٢٥
//    أوردر بيرجعوا ٢٤ بوليصة و«تم».
async function handleBostaAWB(request, env) {
  assertEnv(env, 'bosta');

  const body = await request.json().catch(() => ({}));
  const ids  = [...new Set((Array.isArray(body.deliveryIds) ? body.deliveryIds : [])
                  .map(x => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return json({ ok: false, error: 'deliveryIds مطلوبة' }, 400, request);

  const warnings = [];
  const single   = ids.length === 1;

  const awb = single
    ? await bostaFetchAWB(env, ids[0])
    : await bostaFetchMassAWB(env, ids);

  const pdfBytes = b64Bytes(awb.pdfBase64);
  const pages    = countPdfPages(awb.pdfBase64);

  if (!awb.looksLikePdf) {
    warnings.push('اللي رجع من بوسطة مش شكله PDF — افتح الملف وتأكد قبل ما تطبع');
  }

  // ⚠️ `pages === null` معناها «ما قدرناش نعدّ» مش «صفر» — والفرق ده هو
  //    الفرق بين تحذير صادق وتحذير كاذب.
  if (pages !== null && pages !== ids.length) {
    warnings.push(
      `بوسطة رجّعت ${pages.toLocaleString('en-US')} بوليصة من أصل ` +
      `${ids.length.toLocaleString('en-US')} — فيه شحنة أو أكتر اتشالت من غير ما تقول مين`
    );
  }
  if (pages === null) warnings.push('ما قدرناش نعدّ صفحات الـ PDF — راجع عدد البوالص بنفسك قبل ما تطبع');

  return json({
    ok:        true,
    status:    warnings.length ? 'warning' : 'success',
    mode:      single ? 'single' : 'mass',
    requested: ids.length,
    pages,
    pdfBase64: awb.pdfBase64,
    pdfBytes,
    pdfLooksValid: awb.looksLikePdf,
    // 🔴 **للعرض بس — ممنوع يدخل في أي حارس.** أداتنا نفسها بتحدّث الحقل ده
    //    مع كل جلب، حتى لو الورقة ما خرجتش من الطابعة أصلاً؛ فهو بيقول
    //    «حد جاب البوليصة» مش «ورقة اتطبعت». حارس إعادة الطباعة مصدره D1.
    latestAWBPrintDate: awb.latestAWBPrintDate,
    warnings,
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
    // ⚠️ `AWB` جوّه القايمة عن قصد: عدّاد «مرات الطباعة» وحارس الفاتورة
    //    اللاغية لازم يشوفوا طباعة البوليصة زي طباعة الفاتورة بالظبط —
    //    أوردر بوسطة اتطبع ورجع للطابور عليه ملصق قديم في المخزن.
    types: ['S1', 'S2', 'AWB'],
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

  // ─── بوسطة ─────────────────────────────────────────────────
  // المفتاح موجود؟ (الاسم والطول بس — ممنوع أي قيمة سر تخرج من هنا)
  push('BOSTA_API_KEY', !!env.BOSTA_API_KEY,
    env.BOSTA_API_KEY
      ? `مضبوط (${String(env.BOSTA_API_KEY).length} حرف)`
      : 'غايب — طباعة بوليصة بوسطة مش هتشتغل. ضِفه من Settings → Variables ثم Promote');

  if (env.BOSTA_API_KEY) {
    // البحث (v2) — بمرجع وهمي، صفر أثر
    try {
      await bostaSearchRefs(env, ['__diag__']);
      push('بوسطة — البحث (v2)', true, 'المفتاح مقبول والـ endpoint شغّال');
    } catch (e) { push('بوسطة — البحث (v2)', false, e.message); }

    // البوليصة المفردة (v1) — id وهمي. **400 هو المتوقع** ومعناه إن المسار
    // موجود والمفتاح مقبول؛ 401/403 معناها المفتاح مرفوض؛ 404 معناها بوسطة
    // غيّرت الـ API. صفر أثر على أي شحنة حقيقية.
    try {
      const r = await fetch(`${BOSTA_BASE_V1}/deliveries/awb/__diag__`, {
        headers: { 'Authorization': env.BOSTA_API_KEY },
      });
      const detail =
        r.status === 400 ? 'المسار موجود والمفتاح مقبول (400 على id وهمي = المتوقع)' :
        (r.status === 401 || r.status === 403) ? 'المفتاح مرفوض على المسار ده' :
        r.status === 404 ? 'المسار مش موجود — بوسطة غيّرت الـ API' :
        `رد غير متوقع: HTTP ${r.status}`;
      push('بوسطة — البوليصة المفردة (v1)', r.status === 400, detail);
    } catch (e) { push('بوسطة — البوليصة المفردة (v1)', false, e.message); }

    // 🔴 `mass-awb` بالمفتاح الخام — ده كان **سؤال مفتوح**: كل اختبارات
    //    المجمّع اتعملت بتوكن جلسة الداشبورد (JWT)، والمفتاح الخام متأكَّد
    //    على المسار المفرد بس. البند ده بيجاوبه على الشاشة بدل ما يفضل
    //    افتراض. 401/403 = الدفعة مش هتشتغل والأداة بترجع للمسار المفرد.
    //    ⚠️ `mass-awb` **غير موثّق رسميًا** (مستنتَج من الداشبورد)، فبوسطة
    //    تقدر تغيّره من غير إشعار — عشان كده البند ده دايم هنا مش مؤقت.
    try {
      const r = await fetch(`${BOSTA_BASE_V2}/deliveries/mass-awb`, {
        method:  'POST',
        headers: { 'Authorization': env.BOSTA_API_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: '__diag__' }),
      });
      const keyRejected = (r.status === 401 || r.status === 403);
      const detail =
        keyRejected     ? 'المفتاح الخام مرفوض — الطباعة المجمّعة مش متاحة، الأداة بترجع للمسار المفرد' :
        r.status === 404 ? 'المسار مش موجود — بوسطة غيّرت الـ API' :
        `المفتاح الخام مقبول (HTTP ${r.status} على id وهمي)`;
      push('بوسطة — الطباعة المجمّعة (mass-awb · v2)', !keyRejected && r.status !== 404, detail);
    } catch (e) { push('بوسطة — الطباعة المجمّعة (mass-awb · v2)', false, e.message); }
  }
  // ───────────────────────────────────────────────────────────

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
      if (method === 'POST' && path === '/lookup')  return handleLookup(request, env);
      if (method === 'POST' && path === '/invoice') return handleInvoice(request, env);
      if (method === 'POST' && path === '/track')   return handleTrack(request, env);
      if (method === 'POST' && path === '/logs')    return handleLogs(request, env);
      // ─── §BOSTA (action routing — الشكل القياسي للجديد) ───────
      if (action === 'bosta_lookup') {
        if (method !== 'POST') return json({ error: 'POST required' }, 405, request);
        return handleBostaLookup(request, env);
      }
      if (action === 'bosta_awb') {
        if (method !== 'POST') return json({ error: 'POST required' }, 405, request);
        return handleBostaAWB(request, env);
      }
      // ──────────────────────────────────────────────────────────

      return json({ error: 'Not found' }, 404, request);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500, request);
    }
  },
};
