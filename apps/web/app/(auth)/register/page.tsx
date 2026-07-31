import { redirect } from 'next/navigation';

// /register is superseded by /signup (email + password only; name deferred to
// onboarding). Kept as a permanent redirect so old links/bookmarks still work.
export default function RegisterRedirect() {
  redirect('/signup');
}
