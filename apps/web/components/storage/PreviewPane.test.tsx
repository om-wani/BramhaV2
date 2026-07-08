import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PreviewPane } from './PreviewPane'
import type { FileDto } from '@bramha/shared'

// Mock the api-client so no real fetches happen
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ url: 'https://example.com/presigned-url' }),
  },
}))

import { api } from '@/lib/api-client'

function makeFile(overrides: Partial<FileDto> = {}): FileDto {
  return {
    id: 'file-123',
    projectId: 'proj-abc',
    uploadedBy: crypto.randomUUID(),
    roomId: null,
    name: 'document.pdf',
    declaredMime: 'application/pdf',
    detectedMime: null,
    sizeBytes: 99999,
    storageKey: 'staging/x/y',
    scanStatus: 'clean',
    scanReport: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('PreviewPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows quarantine alert and no download button for quarantined file', () => {
    const file = makeFile({ scanStatus: 'quarantined', name: 'virus.zip' })
    render(
      <PreviewPane file={file} projectId="proj-abc" onClose={vi.fn()} />,
      { wrapper }
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent(/quarantined/i)
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
    // download-url query must NOT be triggered for quarantined files
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith(
      expect.stringContaining('download-url'),
      expect.anything(),
    )
  })

  it('shows file metadata for non-quarantined file', () => {
    const file = makeFile({ scanStatus: 'pending', name: 'pending-file.pdf' })
    render(
      <PreviewPane file={file} projectId="proj-abc" onClose={vi.fn()} />,
      { wrapper }
    )

    expect(screen.getByText('pending-file.pdf')).toBeInTheDocument()
    expect(screen.getByText(/application\/pdf/i)).toBeInTheDocument()
  })

  it('"Ask about this file" link has correct href', () => {
    const file = makeFile({ scanStatus: 'clean', name: 'report.pdf' })
    render(
      <PreviewPane file={file} projectId="proj-abc" onClose={vi.fn()} />,
      { wrapper }
    )

    const link = screen.getByRole('link', { name: /ask about this file/i })
    expect(link).toHaveAttribute('href', '/p/proj-abc/conference?fileRef=file-123')
  })
})
