/**
 * OpenTelemetry SDK initialization.
 * Call initTelemetry() at process start — before any other imports that create spans.
 *
 * Exports: initTelemetry, tracer, meter
 * Env vars: OTEL_EXPORTER_OTLP_ENDPOINT (default http://localhost:4318), OTEL_SERVICE_NAME
 */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { Resource } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { trace, metrics } from '@opentelemetry/api'

const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318'
const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'bramha-unknown'
const serviceVersion = process.env['npm_package_version'] ?? '0.0.0'

let sdk: NodeSDK | null = null

export function initTelemetry(): void {
  if (sdk) return // idempotent

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 30_000,
    }),
  })

  sdk.start()

  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(console.error)
  })
}

export const tracer = trace.getTracer(serviceName, serviceVersion)
export const meter = metrics.getMeter(serviceName, serviceVersion)

// Pre-built histograms for common metrics
export const firstTokenLatencyMs = meter.createHistogram('bramha.turn.first_token_latency_ms', {
  description: 'Time from turn start to first token received from LLM',
  unit: 'ms',
})

export const tokenSpendCounter = meter.createCounter('bramha.turn.tokens_spent', {
  description: 'Total tokens spent per turn (input + output)',
})

export const sandboxActiveGauge = meter.createObservableGauge('bramha.sandbox.active_containers', {
  description: 'Number of sandbox containers currently running',
})
