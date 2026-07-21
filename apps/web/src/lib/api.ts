export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ title: res.statusText }));
    throw Object.assign(new Error(err.title ?? 'Request failed'), {
      status: res.status,
      code: err.code,
    });
  }
  return (res.status === 204 ? null : res.json()) as Promise<T>;
}
