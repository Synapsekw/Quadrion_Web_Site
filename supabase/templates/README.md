# Quadrion authentication emails

## Password reset

- Subject: **Reset your Quadrion password**
- Body: [`reset-password.html`](reset-password.html)
- Hosted project: Quadrion (`oxjrkodcmflxejdwsuac`)
- Dashboard: Authentication → Emails → Reset password

The production template is managed in Supabase; a Netlify/Git deployment does not update it. Paste the complete HTML into the body editor and save the subject separately. The recovery button and copyable fallback both use Supabase's `{{ .ConfirmationURL }}`. Keep that variable intact so the existing verification and approved `/portal/account/` callback continue to work. Do not substitute a fixed portal URL for the recovery link.

The layout uses inline styles, presentation tables, an Outlook fixed-width fallback, mobile spacing, and the existing publicly hosted PNG brand mark. The product name and instructions remain readable when a mail client blocks images. The template adds no tracking, JavaScript, form, new authentication route, or sender configuration.

Configured in production on 16 October 2026. Verified the saved subject/body after reload and reviewed the browser rendering on desktop and at 390 px, with a dummy recovery URL of representative length. The logo loads from the public website. Inbox-specific rendering and a newly delivered reset message have not been tested for this template.

[Supabase email-template variables](https://supabase.com/docs/guides/auth/auth-email-templates)
