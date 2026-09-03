# طابعة الفواتير (`Order-Printer`)

**بتعمل إيه:** الموظف بيختار أوردرات جاهزة للطباعة (S1 عادي · S2 استبدال/استرجاع)، بيطبع فواتيرها، والأداة بتسجّل الطباعة وبتحدّث حالة الأوردر لـ `Ready`.
**مين بيستخدمها:** مخزن
**الإصدار:** Worker `v1.1.1` · الواجهة بلا رقم (مفيش `TOOL_VERSION` في الـ HTML)

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Order-Printer/
الـ Worker : https://order-printer-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: order-printer-worker     ← مطابق لـ name في wrangler.toml
```

## الـ Endpoints

> الأداة دي **مش** بتستخدم نمط `?action=` — الراوتينج بالـ path، وكلها `POST`.

| المسار | بيعمل إيه |
|---|---|
| `POST /orders` | أوردرات S1 + S2 الجاهزة للطباعة |
| `POST /invoice` | بيانات فاتورة أوردر واحد (بنود · خصومات · مرتجع · استبدال) |
| `POST /track` | تسجيل في D1 + تاج `Printed(S1/S2)` + ميتافيلد وقت الطباعة + الحالة `Ready` |
| `POST /logs` | سجل الطباعة من D1 |
| `?action=import_logs` | ⚠️ endpoint ترحيل مؤقت — شوف الفخاخ |

## D1

```
tool  : order_printer
type  : S1 · S2
```

⚠️ **مفيش `login`/`logout`** — مفيش شاشة دخول؛ الاتصال بـ Worker URL + Secret
متخزّنين في `localStorage` عند الموظف. وضع قايم موروث، مش قاعدة.

## ثوابت مزروعة في الكود (مش في `[vars]`)

```
DATE_FROM   = "2026-04-01"                    ← الأقدم من كده مبيظهرش خالص
ZONE_FILTER = ["Cairo+Giza", "Show_Room"]     ← أي zone تانية بتتفلتر من /orders بصمت
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
| `SHOP_DOMAIN` | var بيفشل لو غاب — صفوف D1 الحديثة تثبت وجوده |
| — | var ليه fallback: **مفيش ولا واحد** ✅ فمفيش خطر «أرقام غلط بصمت» هنا |

## CORS

`wildcard *` في كل الردود. الأداة **كتابة**، فالـ wildcard مش الشكل المفضّل —
البوابة الفعلية هي `WORKER_SECRET` في كل نداء. (بند مفتوح تحت.)

## خط الأساس قبل النقل

> أحمد ماداش خط أساس، فاتاخد بديل من D1 (سكيل النقل §0-ب). نفس الاستعلام بعد
> النقل لازم يرجّع أرقام **أكبر أو تساوي** دي.

```
tool = 'order_printer'  —  قراءة 03-09-2026
S1 : 4,183 صف  (آخر صف 2026-09-02T14:00:38Z)
S2 :   186 صف  (آخر صف 2026-09-02T12:30:28Z)
```

```sql
SELECT type, COUNT(*) AS n, MAX(timestamp) AS last_ts FROM logs WHERE tool = 'order_printer' GROUP BY type;
```

## فخاخ الأداة دي

- 🔴 **`?action=import_logs` لسه منشور وملوش idempotency** — الكود نفسه معلّم
  عليه «امسحه فور تأكيد الـ Migration». نفس الشكل اللي كتب **925 صف مكرر** في
  `cod-payment-center-worker` (`ecommoda-constants` §11 بند 13). النقل ما مسحوش
  عشان `index.js` يفضل مطابق حرفيًا لكلاودفلير.
- **`ZONE_FILTER` بيفلتر بصمت** — «الأوردر مش ظاهر» = افحص `custom.zone` الأول.
- **`/track` بيعمل ٣ كتابات على Shopify بالتوازي**، وفشل واحدة **مش** بيفشل
  النداء. لو الحالة ما اتغيّرتش، بصّ على `statusResult` في الرد.
- **الواجهة بتنادي `/track` بـ `.catch(() => {})`** — فشل التسجيل مش بيوصل للموظف.

## استرجاع النسخ القديمة

```
Indexv-iframe.html · Indexv-jspdf.html  →  commit 0f99338
Index-pdf.html (الأقدم)                 →  commit 85de4d6

git show 0f99338:Indexv-iframe.html
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v1.0.0 |
| ecommoda-html-builder | v1.0.0 |
| ecommoda-constants | v1.0.0 |

آخر مطابقة: 03-09-2026 · `index.js` v1.1.1 · `index.html` (بلا رقم)
🔴 معلّقة: `?action=import_logs` — endpoint ترحيل مؤقت بلا idempotency، حذفه متأجّل عشان النقل يفضل byte-for-byte

> ⚠️ `v1.0.0` هنا معناها **«قبل النظام»، مش «مطابقة»** (`ecommoda-skill-versioning`
> Step 5). الكود اتنقل كما هو بلا retrofit. الإصدارات الحالية وقت النقل:
> worker-builder **v2.0.0** · html-builder **v6.2.0** · constants **v1.4.3**.

## مسائل مفتوحة

- **حذف `?action=import_logs`** — قرار أحمد، في PR مستقل مش في PR النقل.
- **retrofit على القواعد الحالية** — بنود 🔴 من CHANGELOG الثلاث مهارات فوق.
  **مش حملة** — يتعمل أول ما الأداة تتفتح لسبب حقيقي.
- **شاشة الدخول الموحّدة** (`employees-admin-panel-worker`) بدل Worker URL +
  Secret في `localStorage` — قرار مستقل.
- **تضييق `Build watch paths`** على `index.js` + `wrangler.toml` (§13-ب) —
  لو اتعمل، يتوثّق هنا، وأي ملف جديد بيعتمد عليه الـ Worker يتضاف للقايمة.
- **placeholder في شاشة الإعدادات بيشاور على حساب مهجور**
  (`...ecommoda24.workers.dev`) — نص placeholder بس، اتساب عشان الواجهة تفضل
  byte-for-byte.

آخر تحديث: 03-09-2026
