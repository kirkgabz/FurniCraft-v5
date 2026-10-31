# FurniCraft Developer Guide

This guide provides step-by-step instructions for setting up, developing, testing, and deploying **FurniCraft**.

---

## 1. Prerequisites

- **Node.js**: v20.x LTS or higher
- **Package Manager**: npm (v10+)
- **Supabase CLI**: v2.x (`npm install -g supabase` or via `npx supabase`)
- **Git**: For version control

---

## 2. Local Environment Setup

### 2.1 Clone Repository & Install Dependencies
```bash
git clone https://github.com/your-username/furnicraft-v4.git
cd furnicraft-v4
npm install
```

### 2.2 Configure Environment Variables
Create a `.env.local` file in the project root:

```env
# Supabase API Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key

# Resend SMTP Configuration (Required for transactional auth emails)
RESEND_API_KEY=re_your_resend_api_key

# Public Site URL (Used for auth redirects and OpenGraph metadata)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

---

## 3. Database & Migrations Workflow

FurniCraft uses declarative SQL migrations stored in `supabase/migrations/`.

### 3.1 Linking to Remote Supabase Project
```bash
# Sign in to Supabase CLI
npx supabase login

# Link local workspace to your cloud project
npx supabase link --project-ref <your-project-id>
```

### 3.2 Applying Migrations
Apply all pending schema migrations sequentially:
```bash
npx supabase db push
```
*(On Windows PowerShell, use `npx.cmd supabase db push` if script execution policy restricts `.ps1` shims).*

### 3.3 Granting Local / First Admin Account
After applying migrations, execute the following SQL statement in the Supabase SQL Editor to grant yourself administrative permissions:

```sql
UPDATE public.user_profiles 
SET is_admin = true 
WHERE id = (SELECT id FROM auth.users WHERE email = 'your-email@example.com');
```

---

## 4. Running the Development Server

Start the Next.js 16 development server with Turbopack:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Transactional Email Setup (Resend SMTP)

FurniCraft delegates all authentication emails (confirmations, password resets, magic links) to **Resend** to avoid the 2/hour rate-limit on Supabase's shared default sender.

### Configuring Supabase SMTP Dashboard:
1. Navigate to **Authentication → SMTP Settings** in the Supabase Dashboard.
2. Enable Custom SMTP and enter:
   - **Sender email**: `noreply@yourdomain.com` (or `onboarding@resend.dev` for testing)
   - **Sender name**: `FurniCraft`
   - **Host**: `smtp.resend.com`
   - **Port**: `587`
   - **User**: `resend`
   - **Password**: Your Resend API Key (`re_...`)
3. Under **Authentication → URL Configuration**:
   - Set **Site URL**: `https://your-domain.com`
   - Add **Redirect URLs**: `https://your-domain.com/**` and `http://localhost:3000/**`

---

## 6. Code Quality & Security Audits

### 6.1 Linting
```bash
npm run lint
```

### 6.2 Database Security & Performance Advisors
Run the Supabase linter to catch broken RLS policies or unindexed foreign keys:
```bash
npx supabase db advisors --linked --type security
npx supabase db advisors --linked --type performance
```

---

## 7. Production Deployment (Vercel)

1. Push your repository to GitHub / GitLab.
2. Import the project into [Vercel](https://vercel.com).
3. Set the Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` (Set to your production domain, e.g., `https://furnicraft.space`)
   - `RESEND_API_KEY`
4. Click **Deploy**. Vercel will automatically build the Next.js 16 App Router application.
