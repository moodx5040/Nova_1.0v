# NOVA CHAT ULTIMATE

نسخة تطويرية متقدمة مبنية بـ HTML/CSS/JavaScript + Supabase.

## قبل البدء
- تحتاج مشروع Supabase.
- تحتاج حساب مؤسس تم إنشاؤه في Authentication.
- لا تضع `service_role` في ملفات الموقع. المسموح في الواجهة هو Project URL و anon/publishable key فقط.
- هذه الملفات ليست منشورة على الإنترنت بعد.

## 1) إعداد قاعدة البيانات
1. افتح Supabase > SQL Editor > New query.
2. افتح `supabase/schema.sql`.
3. شغّل كامل محتوى الملف مرة واحدة.
4. من Authentication > Users انسخ UUID لحساب المؤسس.
5. شغّل:
   ```sql
   update public.profiles
   set role='founder'
   where id='ضع-UUID-المؤسس-هنا';
   ```
6. تحقق:
   ```sql
   select id, username, role from public.profiles;
   ```

إذا كان حسابك موجوداً قبل تشغيل SQL ولم يظهر في profiles، نفّذ:
```sql
insert into public.profiles(id,username,display_name)
select id,
       lower(regexp_replace(split_part(email,'@',1),'[^a-z0-9_]','','g')),
       coalesce(raw_user_meta_data->>'display_name', split_part(email,'@',1))
from auth.users
where id not in (select id from public.profiles);
```
إذا تعارض اسم مستخدم، عدّله يدوياً إلى اسم فريد ثم عيّن دور المؤسس.

## 2) ربط الموقع
1. من Supabase > Project Settings > API انسخ Project URL.
2. انسخ anon / publishable public key فقط.
3. افتح `app.js` وابحث عن:
   `PASTE_SUPABASE_URL` و `PASTE_SUPABASE_ANON_KEY`
4. استبدلهما بالقيم الصحيحة. لا تضع service_role أو database password.

## 3) تشغيل الموقع
- محلياً: افتح المجلد في VS Code واستخدم Live Server.
- أو ارفع الملفات إلى GitHub repository ثم فعّل GitHub Pages من Settings > Pages.
- ارفع محتويات مجلد المشروع (index.html و style.css و app.js و مجلد supabase) إلى جذر المستودع.

## 4) Realtime
من Supabase > Database > Replication أو Publications، فعّل Realtime للجداول:
- messages
- rooms
- announcements

## 5) المزايا الحالية
- إنشاء حساب وتسجيل دخول بالبريد وكلمة المرور.
- ملفات شخصية وأسماء مستخدمين عامة دون عرض البريد.
- غرف عامة مع العضوية.
- محادثات خاصة DM.
- رسائل فورية عبر Realtime، رد، تعديل وحذف رسائلك.
- مرفقات صور وPDF وTXT عبر Supabase Storage.
- تفاعلات على الرسائل.
- Presence لعدد المتصلين وTyping indicator.
- بلاغات وإعلانات.
- لوحة مؤسس تشمل إدارة الأعضاء، الحظر وفك الحظر، الكتم، الشارات/الأدوار، إدارة الغرف، حذف إداري، مراجعة البلاغات، الصيانة، الكلمات الممنوعة، وسجل الإدارة.
- صلاحيات المؤسس محمية عبر دوال قاعدة البيانات وRLS.

## تنبيهات صريحة
- لا يوجد نظام مكالمات صوت/فيديو في هذه النسخة.
- رفع المرفقات متاح للأنواع والحجم المحددين في SQL.
- روابط المرفقات في هذا الإعداد عامة؛ لا ترفع معلومات خاصة أو حساسة.
- Presence يعتمد على قناة Supabase Realtime ويحتاج تفعيل Realtime واتصالاً مستقراً.
- لا تعتبر النسخة جاهزة لإطلاق عام واسع قبل اختبار سياسات RLS، إعداد CAPTCHA/قيود التسجيل، حدود الاستخدام، النسخ الاحتياطي، ومراجعة أمنية مستقلة.
- إعدادات الحظر والكتم وإدارة المنصة تتم عبر دوال Founder RPC، لا عبر إخفاء الأزرار فقط.
