export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ title: res.statusText }));
    throw Object.assign(new Error(err.title ?? 'Request failed'), {
      status: res.status,
      code: err.code,
    });
  }
  // Some endpoints (e.g. register) return 201 with an empty body — calling
  // res.json() on that throws "Unexpected end of JSON input". Guard on both
  // status and actual content length.
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
