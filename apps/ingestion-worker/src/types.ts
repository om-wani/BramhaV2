import { z } from 'zod'

/**
 * Zod schema for the BullMQ job payload produced by the upload API.
 * Parsed at the top of SecurityGateProcessor.process() to catch invalid
 * job data early rather than letting it propagate as confusing runtime errors.
 */
export const IngestFileJobDataSchema = z.object({
  fileId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  storageKey: z.string().min(1),
  declaredMime: z.string().min(1),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

export type IngestFileJobData = z.infer<typeof IngestFileJobDataSchema>
