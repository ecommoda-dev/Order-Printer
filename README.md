<div dir="rtl" style="text-align: right;">

# طابعة الفواتير — Order Printer

![version](https://img.shields.io/badge/version-v1.0.0-blue)

أداة داخلية لـ EcomModa: الموظف بيختار الأوردرات الجاهزة للطباعة، بيطبع فواتيرها،
والأداة بتسجّل الطباعة وبتحدّث حالة الأوردر على Shopify.

## الروابط

| | |
|---|---|
| الواجهة | <https://ecommoda-dev.github.io/Order-Printer/> |
| الـ Worker | <https://order-printer-worker.ecommoda-dev.workers.dev> |

## بنية الريبو

| الملف | إيه ده |
|---|---|
| `index.js` | كود الـ Cloudflare Worker — بينشر أوتوماتيك على `main` |
| `wrangler.toml` | اسم الـ Worker + D1 binding + `[vars]` |
| `index.html` | الواجهة — بتتنشر على GitHub Pages |
| `Index.html` | صفحة تحويل للروابط القديمة (بلا أي منطق) |
| `CLAUDE.md` | قواعد الأداة — بتتحمّل في كل جلسة Claude |

## النشر

```
git push على main  ─┬─→  Workers Builds  →  الـ Worker لايف (~٢٣ ثانية)
                    └─→  GitHub Pages    →  الواجهة لايف (أبطأ — دقيقة–اتنين)
```

⛔ **ممنوع اللصق في داشبورد Cloudflare بعد الربط** — أول push جاي بيمسحه.
الريبو ده هو المصدر الوحيد لكود الأداة.

## قبل أي تعديل

اقرا `CLAUDE.md` — فيه الفخاخ، وتصنيف الـ `env.*`، وخط الأساس، والمسائل المفتوحة.

آخر تحديث: 03-09-2026 — 10:39

</div>
