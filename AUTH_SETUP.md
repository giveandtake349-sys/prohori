# Prohori Auth setup

## এই code-এ কী যোগ হয়েছে

- Supabase Auth দিয়ে email/password sign-up ও sign-in। Hosted Supabase-এ email confirmation চালু থাকলে inbox-এর verification link চাপতে হবে।
- Google sign-in flow এবং প্রথম login-এ নাম/মোবাইল নিয়ে Prohori profile তৈরি।
- API প্রতিটি protected request-এর bearer token Supabase Auth-এর কাছে যাচাই করে। body-তে পাঠানো `user_id`, `reporter_id` বা `actor_id`-কে আর পরিচয়ের প্রমাণ হিসেবে ধরা হয় না।
- Report জমা, corroboration, action claim, fraud report, team তৈরি/যোগদান, SOS ও moderator review authenticated। Team সদস্য না হলে emergency contact নম্বর দেখা যাবে না।
- Auth-এর জন্য নতুন database migration লাগে না; আগের `public.users.id`-এর সঙ্গে Supabase Auth user UUID যুক্ত হয়।

## Supabase project URL allow-list

Supabase Dashboard-এ **Prohori** project খুলে **Authentication → URL Configuration**-এ:

- **Site URL:** `https://prohori-teal.vercel.app`
- **Redirect URLs:** `https://prohori-teal.vercel.app` এবং local development-এর জন্য `http://localhost:5173/**`

Vercel preview deployment-এ OAuth/email callback-ও চাইলে preview domain pattern-টি Redirect URLs-এ যোগ করুন; production site URL-টি production domain-এ রেখেই দিন.

Render API-তে `SUPABASE_URL` ও `SUPABASE_PUBLISHABLE_KEY` environment variables Prohori project-এর জন্য সেট করা হয়েছে; বিদ্যমান `DATABASE_URL` বদলানো হয়নি। Browser app-এ ব্যবহৃত publishable key public—এটি secret/service-role key নয়।

## Google sign-in চালু করা

Google OAuth client তৈরি ও Google secret-এর মালিকের account access প্রয়োজন; secret chat বা GitHub-এ দেবেন না।

1. Google Cloud Console-এ একটি OAuth Client ID তৈরি করুন, type **Web application**।
2. **Authorized JavaScript origins**-এ `https://prohori-teal.vercel.app` যোগ করুন।
3. **Authorized redirect URI** হিসেবে হুবহু যোগ করুন: `https://okzgthxdkegwmttyyrvj.supabase.co/auth/v1/callback`
4. Supabase Dashboard → **Authentication → Sign In / Providers → Google**-এ Google provider enable করে Google Client ID ও Client Secret বসিয়ে Save করুন।
5. Prohori site-এ Login → **Google দিয়ে চালিয়ে যান** চাপুন। প্রথমবার নাম/মোবাইল দিয়ে profile সম্পূর্ণ করুন।

## Moderator/admin account

নতুন account-এর role নিরাপত্তার কারণে `citizen` থাকে। নিজের account দিয়ে sign-up, email verification ও profile সম্পূর্ণ করার পর, Supabase SQL Editor-এ নিজের email বসিয়ে নিচের SQL চালালে সেই account-টি admin হবে:

```sql
UPDATE public.users AS u
SET role = 'admin'
FROM auth.users AS au
WHERE au.id = u.id
  AND lower(au.email) = lower('YOUR_EMAIL@example.com');
```

এটি শুধু নিজের account-এর জন্য চালাবেন। এরপর sign out/in করলে moderator review queue ব্যবহার করা যাবে।

## SOS-এর সীমা

SOS alert database-এ সংরক্ষিত হয় এবং কাছাকাছি user/team গণনা করা হয়। এই MVP-তে এখনো SMS বা mobile push delivery provider সংযুক্ত নেই; জরুরি বিপদে **৯৯৯**-এ কল করুন।
