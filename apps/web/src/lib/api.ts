export async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ title: res.statusText }));
    throw Object.assign(new Error(err.title ?? 'Request failed'), {
      status: res.status,
      code: err.code,
    });
  }
  return res.json();
}
