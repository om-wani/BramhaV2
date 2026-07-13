/**
 * /api/health — liveness probe for the Docker healthcheck (Dockerfile.web).
 * No dependencies checked here (Next.js has none of its own besides the API
 * it talks to, which has its own separate healthcheck) — just confirms the
 * standalone server is up and serving requests.
 */
export function GET(): Response {
  return Response.json({ status: 'ok' })
}
