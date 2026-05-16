# User Access & Admin Roles Implementation Plan

This plan introduces user roles, stores user details in Firestore, protects data with security rules, and adds an admin page for you to manage access.

## Proposed Changes

### Firestore Security Rules
We will update `firestore.rules` to protect your data and enforce roles:
- **Users Collection (`/users/{userId}`)**:
  - Anyone can create their initial profile. To prevent privilege escalation, new users cannot set `isPlatformOwner` or `hasAccess` to `true` unless their email is exactly `l.vorabouth@gmail.com`.
  - Only a platform owner can update profiles (e.g. granting access).
  - Users can read their own profile, and platform owners can read all profiles.
- **Dashboard Data (`/dashboardData/...`)**:
  - `allow read:` will be updated so that only users with `hasAccess == true` (or `isPlatformOwner == true`) can read the underlying prediction data.

### Firebase Client Code (`app/auth-gate.jsx`)
- Upon sign-in, we will check if the user exists in the `users` collection.
- If they don't exist, we will create a document with their `email`, `uid`, `displayName` (if available), and default roles:
  - If their email is `l.vorabouth@gmail.com`, they get `isPlatformOwner: true` and `hasAccess: true`.
  - Otherwise, they get `isPlatformOwner: false` and `hasAccess: false`.
- We will subscribe to their Firestore user document. If they don't have access, the `AuthGate` will show a "Pending Approval" message instead of rendering the dashboard.

### Admin Dashboard (`app/dashboard/admin/page.jsx`)
- **[NEW] Admin Page**: A new page accessible at `/dashboard/admin`.
- It will query all users from the `users` collection.
- It will display a list/table of users showing their email, access status, and roles.
- It will include a toggle switch/button to grant or revoke `hasAccess` for individual users.
- The UI will be consistent with the dark/modern theme of the app and strictly gated so only platform owners can view it.

## User Review Required
> [!IMPORTANT]
> The hardcoded owner email will be `l.vorabouth@gmail.com`. If you ever want to change this, it will need to be updated in the security rules and client code.
> Is this exact email correct? Let me know if you approve this approach!

## Verification Plan

### Manual Verification
1. I will log in with a test account and verify I see the "Pending Approval" screen.
2. I will log in with `l.vorabouth@gmail.com` and verify I have immediate access to the dashboard.
3. I will navigate to `/dashboard/admin`, see the test user, and grant them access.
4. I will verify the test user then sees the main dashboard immediately.
