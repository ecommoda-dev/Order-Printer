<div dir="rtl" style="text-align: right;">

# طابعة الفواتير (`Order-Printer`)

![version](https://img.shields.io/badge/version-v3.1.1-blue)

**بتعمل إيه:** الموظف بيسجّل دخول بـ PIN، بيختار أوردرات جاهزة للطباعة (S1 عادي · S2 استبدال/استرجاع)، بيطبع فواتيرها، والأداة بتسجّل الطباعة باسمه وبتحدّث حالة الأوردر لـ `Ready`.
**مين بيستخدمها:** مخزن
**الإصدار:** Worker `v2.0.0` · الواجهة `v3.1.1` (`TOOL_VERSION`) · `MIN_WORKER_VERSION = 2.0.0`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Order-Printer/
الـ Worker : https://order-printer-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: order-printer-worker     ← مطابق لـ name في wrangler.toml
```

## الـ Endpoints

> الأداة بترّوت بطريقتين مع بعض: **path** لنداءات الأداة نفسها (شكل تاريخي متساب
> عمدًا)، و**`?action=`** للمشترك القياسي (Auth · Logs · Diag).

| المسار | بيعمل إيه |
|---|---|
| `POST /orders` | أوردرات S1 + S2 الجاهزة للطباعة (+ `zoneExcluded`) |
| `POST /invoice` | بيانات فاتورة أوردر واحد (+ `truncatedLineItems`) |
| `POST /track` | تسجيل الطباعة + تاج + ميتافيلد الوقت + الحالة `Ready`. **بيطلب `employee`** |
| `POST /logs` | سجل الطباعة بعدّاد لكل أوردر (+ `cap` · `total` · `truncated`) |
| `GET ?action=check_employee` · `POST register_pin` · `POST verify_employee` | Universal D1 Auth |
| `GET ?action=log_logout` · `GET ?action=get_employees` | Universal D1 Auth |
| `GET ?action=get_logs` · `get_logs_count` · `get_logs_export` | سجل العمليات القياسي |
| `GET ?action=diag` | فحص ذاتي بدون كتابة — متغيرات · D1 · موظفين · OAuth · صلاحيات · Origin |
| `GET ?action=get_config` | `WORKER_VERSION` — الواجهة بتقارنه بـ `MIN_WORKER_VERSION` |

## D1

```
tool  : order_printer      · type : S1 · S2 · login · logout
tool  : metafields_change  · type : update      ← الأداة بقت كاتب تاني تحت الصف ده
```

🔴 **بند تسجيل مفتوح في `ecommoda-constants` §7 — لازم يتقفل:**
صف Order Printer مسجّل `S1 · S2` بس. النسخة دي بتكتب كمان `login` و`logout`،
وبقت **كاتب جديد** تحت `metafields_change` / `update` بمفتاح إسناد
`extra.source = "order_printer"`. التلات بنود دول لازم يتضافوا في §7.

⚠️ **عمود `order_id`:** الصفوف الجديدة بترجّع **الرقم المجرد** (`5678901234567`)
تنفيذًا لقاعدة الـ numeric order ID. الصفوف التاريخية (قبل v2.0.0) فيها الـ GID
كامل (`gid://shopify/Order/...`) — أي استعلام بيقارن العمود ده لازم ياخد باله.

## تسجيل الدخول

Universal D1 Auth كامل — شاشة دخول بـ PIN على خطوتين، و`currentEmployee` في
ذاكرة الـ JS بس (عمره ما يروح `localStorage`). الـ `WORKER SECRET` هو الحقل
الوحيد في شاشة الإعدادات؛ الـ `WORKER_URL` بقى **ثابت في `§CONFIG`** مش حقل
إدخال (Standards #28).

> قبل v2.0.0 مكانش فيه شاشة دخول خالص، فعمود `employee` **فاضي في كل الصفوف
> التاريخية** — مش هيتملي بأثر رجعي.

## ثوابت مزروعة في الكود (مش في `[vars]`)

```
DATE_FROM   = "2026-04-01"                    ← الأقدم من كده مبيظهرش خالص
ZONE_FILTER = ["Cairo+Giza", "Show_Room"]     ← بيفلتر، بس بقى بيرجّع zoneExcluded
LOGS_FETCH_MAX  = 5000                        ← سقف /logs — بيرجع كـ cap
LOG_EXPORT_MAX  = 2000                        ← سقف get_logs_export
```

## المضبوط فعليًا في الداشبورد

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET
Vars     : SHOP_DOMAIN                        ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي — التضييق ما اتعملش)
```

تصنيف الـ `env.*` (`ecommoda-tool-migration-playbook` §4-أ-٢):

| المتغيّر | التصنيف |
|---|---|
| `WORKER_SECRET` · `CLIENT_ID` · `CLIENT_SECRET` | سر — يدوي دايمًا |
| `SHOP_DOMAIN` | var بيفشل لو غاب — و`assertEnv` بقى بيسمّيه بالاسم |
| — | var ليه fallback: **مفيش ولا واحد** ✅ |

## CORS

**Option B — allowlist**: `['https://ecommoda-dev.github.io']` + `Vary: Origin`.
اتغيّرت في v2.0.0 من `wildcard *` — الأداة كتابة على شوبيفاي. البوابة الفعلية
لسه `WORKER_SECRET` في كل نداء.

## خط الأساس قبل النقل

```
tool = 'order_printer'  —  قراءة 03-09-2026
S1 : 4,183 صف  (آخر صف 2026-09-02T14:00:38Z)
S2 :   186 صف  (آخر صف 2026-09-02T12:30:28Z)
```

```sql
SELECT type, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'order_printer' GROUP BY type;
```

## فخاخ الأداة دي

- **`ZONE_FILTER` بيفلتر** — «الأوردر مش ظاهر» = افحص `custom.zone` الأول.
  و**الأوردر اللي مالوش `zone` خالص بيتستبعد هو كمان** (`undefined` مش في
  القايمة) — دي غالبًا السبب الحقيقي، مش «محافظة تانية».
  `/orders` لسه بيرجّع `zoneExcluded` في الرد، لكن **مش معروض في الواجهة**
  (المربّع اتشال بقرار أحمد 03-09-2026) — شوفه من رد الـ endpoint أو `diag`.
- **`Delivered` حالة نهائية** — أي محاولة طباعة S1 لأوردر متسلّم بترجّع
  `warning` والحالة **مش** بتتكتب. ده مقصود (`ecommoda-order-lifecycle` §1.4).
- **`/track` بيرجّع تلات حالات** — `success` · `warning` · `error`. الأصفر معناه
  الطباعة اتسجّلت بس فيه فعل ما تمّش (الحالة مثلاً). **ممنوع يتحسب نجاح.**
- **الحالة الحالية بتتقرا قبل أي كتابة** — لو القراءة فشلت، الحالة **مش**
  بتتكتب والرد بيرجع `warning`. الاتجاه الآمن مقصود.
- **`order_id` مختلط في D1** — رقمي للجديد، GID للقديم (فوق).
- **تسميات النوع في الواجهة عرض بس** — «عادي» / «استبدال/استرجاع» بتيجي من
  `TYPE_LABEL` في الـ HTML. القيم المخزّنة في D1 وفي عقد الـ Worker بتفضل
  `S1`/`S2` حرفيًا — أي فلتر أو استعلام يستخدم القيم دي مش التسميات.
- **مستند الـ iframe مالوش وصول لـ `:root`** — كل ألوان HTML الفاتورة حرفية
  (`#000` / `#fff` / `#555`)، وده استثناء تقني موثّق من Standards #35 مش إهمال.
- **كل التواريخ في الواجهة بيوم القاهرة** (`cairoDayStr`) مش يوم UTC — فلاتر
  الفترة ومربّع «النهارده» والأعمدة. الفرق بيحط أي طباعة بين ١٢ و٣ الفجر في
  اليوم اللي فات، وده كان باج فعلي اتصلّح في v3.0.0.
- **فلترة الجدولين client-side** على البيانات المحمّلة — مقصود: الأداة بتحمّل
  السجل كله عشان تبني عدّاد «مرات الطباعة»، فمفيش pagination من السيرفر.
  `get_logs`/`get_logs_count`/`get_logs_export` موجودين في الـ Worker لكن
  الواجهة مش بتستخدمهم؛ التقصّ بيبان في بانر فوق جدول السجل.

## استرجاع النسخ القديمة

```
Indexv-iframe.html · Indexv-jspdf.html  →  commit 0f99338
Index-pdf.html (الأقدم)                 →  commit 85de4d6
النسخة قبل PR الأمان + المعمارية        →  commit e2cd6da

git show 0f99338:Indexv-iframe.html
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v2.0.0 |
| ecommoda-html-builder | v6.2.0 |
| ecommoda-order-lifecycle | v1.3.0 |
| ecommoda-constants | v1.4.3 |

آخر مطابقة: 03-09-2026 · `index.js` v2.0.0 · `index.html` v3.1.1

## مسائل مفتوحة

- 🔴 **تسجيل `login` · `logout` · الكتابة تحت `metafields_change` في
  `ecommoda-constants` §7** — البند ده **قبل** أي نشر (Rule 7). فوق التفاصيل.
- ⏳ **بند للمهارة مش للأداة:** قاعدة «السبب مع كتابة `manual_status`»
  (`ecommoda-order-lifecycle` §1.5) محتاجة **استثناء مكتوب للأدوات
  الأوتوماتيكية**. القاعدة اتكتبت للتغيير اليدوي (Order Status Updater)، وأداة
  الطباعة بتكتب `Ready` كأثر جانبي فالسبب ثابت ومعروف سلفًا.
  ✅ **محسوم لأداة الطباعة (أحمد، 03-09-2026):** بتسجّل السبب تلقائيًا
  (`notes: "S1: X → Ready (طباعة الفاتورة)"` + `extra.source`) **بدون** ما
  تسأل الموظف. الباقي: البند ده يتضاف للمهارة نفسها.
- **Log Tab v2 بفلترة server-side + pagination** — مؤجّل بقرار: الأداة محتاجة
  السجل كامل عشان عدّاد «مرات الطباعة»، فالفلترة client-side هي الصح هنا
  (`data-table-standard` § 7 بيسمح بالحالة دي بشرط التوثيق — وده التوثيق).
  لو السجل كبر لدرجة إن السقف بقى بيتقص كتير، القرار يتراجع.
- **تضييق `Build watch paths`** على `index.js` + `wrangler.toml` (§13-ب).
- **`compatibility_date = "2025-01-01"`** — مطابق لقالب المهارة الحالي، فاتساب.

آخر تحديث: 03-09-2026 — 18:30

</div>
