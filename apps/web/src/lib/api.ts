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

// Uploads a knowledge file. Mints a short-lived ticket via the proxy (small
// request), then sends the file body DIRECTLY to the backend origin so it
// skips the Vercel proxy's ~4.5 MB request-body limit. Falls back to the
// same-origin proxy when NEXT_PUBLIC_UPLOAD_ORIGIN is unset (local dev).
export async function uploadKnowledgeFile(projectId: string, file: File): Promise<void> {
  const { token } = await apiFetch<{ token: string }>(
    `/backend/projects/${projectId}/files/ticket`,
    { method: 'POST' },
  );

  const origin = process.env.NEXT_PUBLIC_UPLOAD_ORIGIN;
  const url = origin
    ? `${origin.replace(/\/$/, '')}/projects/${projectId}/files`
    : `/backend/projects/${projectId}/files`;

  const form = new FormData();
  form.append('file', file);

  // No Content-Type (browser sets the multipart boundary); Bearer, no cookie.
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ title: res.statusText }));
    throw Object.assign(new Error(err.title ?? 'Upload failed'), {
      status: res.status,
      code: err.code,
    });
  }
}
