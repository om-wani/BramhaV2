import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FileGrid } from './FileGrid'
import type { FileDto } from '@bramha/shared'

function makeFile(overrides: Partial<FileDto> = {}): FileDto {
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    uploadedBy: crypto.randomUUID(),
    roomId: null,
    name: 'test-file.pdf',
    declaredMime: 'application/pdf',
    detectedMime: null,
    sizeBytes: 12345,
    storageKey: 'staging/x/y',
    scanStatus: 'clean',
    scanReport: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('FileGrid', () => {
  const baseProps = {
    folder: 'uploads' as const,
    searchQuery: '',
    selectedFileId: null,
    isLoading: false,
    onSelectFile: vi.fn(),
  }

  it('renders quarantined file with red border, no download button', () => {
    const quarantinedFile = makeFile({ scanStatus: 'quarantined', name: 'virus.zip' })
    render(<FileGrid {...baseProps} folder="quarantine" files={[quarantinedFile]} />)

    const btn = screen.getByRole('button', { name: /virus\.zip/i })
    expect(btn).toHaveClass('border-red-500/50')
    // No download button in the grid itself (download is in PreviewPane)
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
  })

  it('renders clean file with green Ready badge', () => {
    const cleanFile = makeFile({ scanStatus: 'clean', name: 'report.pdf' })
    render(<FileGrid {...baseProps} files={[cleanFile]} />)

    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('renders scanning file with Scanning badge', () => {
    const scanningFile = makeFile({ scanStatus: 'scanning', name: 'doc.txt' })
    render(<FileGrid {...baseProps} files={[scanningFile]} />)

    expect(screen.getByText('Scanning')).toBeInTheDocument()
  })

  it('filters files by search query', () => {
    const files = [
      makeFile({ name: 'invoice-2024.pdf' }),
      makeFile({ name: 'contract.docx' }),
      makeFile({ name: 'invoice-2023.pdf' }),
    ]
    render(<FileGrid {...baseProps} files={files} searchQuery="invoice" />)

    expect(screen.getByText('invoice-2024.pdf')).toBeInTheDocument()
    expect(screen.getByText('invoice-2023.pdf')).toBeInTheDocument()
    expect(screen.queryByText('contract.docx')).toBeNull()
  })

  it('shows origin room chip when roomId present', () => {
    const fileWithRoom = makeFile({ roomId: crypto.randomUUID(), name: 'from-room.pdf' })
    const fileWithoutRoom = makeFile({ roomId: null, name: 'direct.pdf' })
    render(<FileGrid {...baseProps} files={[fileWithRoom, fileWithoutRoom]} />)

    expect(screen.getByLabelText('Origin room')).toBeInTheDocument()
    expect(screen.getByText('Direct upload')).toBeInTheDocument()
  })
})
