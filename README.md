# Student Scholarship Monitoring and Academic Compliance System (Supabase)

HTML / CSS / JavaScript + Supabase (PostgreSQL + Auth) + GitHub Pages.

## Setup
1. Create a project at https://supabase.com.
2. SQL Editor → run `sql/schema.sql`.
3. (Optional) SQL Editor → run `sql/demo_accounts.sql` for the three demo accounts.
4. Project Settings → API → copy the Project URL and `anon` key into `js/config.js`.
5. (Optional, for instant login after registration) Authentication → Providers → Email → turn off "Confirm email".
6. Open `index.html` with a local server (e.g. VS Code Live Server) to test.

## Deploy to GitHub Pages
1. Push this folder to a GitHub repository.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Supabase → Authentication → URL Configuration → set Site URL to your GitHub Pages URL.

## First admin without demo accounts
Register normally, then run in the SQL Editor:
`update public.profiles set role = 'admin' where email = 'you@example.com';`
Afterwards the admin can create staff/admin accounts from User Accounts.

## Roles
- Admin: users, scholars (read), programs/requirements, grade submissions, compliance, reports
- Staff: register scholars, update status, verify grades, compliance, renewal, reports
- Scholar: register account, submit grades, requirements, status, history

## Security
Row Level Security is enabled on every table. Grade verification and renewal run through
`verify_submission()` and `process_renewal()` (staff only), so compliance evaluation cannot be
faked from the browser. Only the `anon` key is used in the frontend.
