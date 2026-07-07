/**
 * @bramha/ingestion-worker
 *
 * Entry point for the module barrel.
 * The actual process entry is src/main.ts (add as "start" script or run directly).
 * This file re-exports the processor so other packages can import it for testing.
 */
export { SecurityGateProcessor } from './security/security-gate.processor.js'
export type {
  SecurityGateDeps,
  IngestFileJobData,
  Disarmer,
} from './security/security-gate.processor.js'
export { ClamAvDownError, ZipBombError, DisarmError } from './security/errors.js'
