'use client'

export function redirectToLogin(next?: string) {
  const url = new URL('/login', window.location.origin)
  if (next) url.searchParams.set('next', next)
  window.location.href = url.toString()
}
