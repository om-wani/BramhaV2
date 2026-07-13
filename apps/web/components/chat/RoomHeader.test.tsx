/**
 * RoomHeader rendering + interaction tests.
 * Runs in jsdom — proves the Artifacts toggle button actually renders and
 * fires its callback, not just that the code typechecks.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RoomHeader } from './RoomHeader'

describe('RoomHeader', () => {
  it('renders the room name', () => {
    render(
      <RoomHeader
        room={{ id: 'r1', name: 'Conference', type: 'conference' }}
        onSwitchBranch={vi.fn()}
        artifactsOpen={false}
        onToggleArtifacts={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Conference' })).toBeTruthy()
  })

  it('fires onToggleArtifacts when the Artifacts button is clicked', () => {
    const onToggleArtifacts = vi.fn()
    render(
      <RoomHeader
        room={{ id: 'r1', name: 'Conference', type: 'conference' }}
        onSwitchBranch={vi.fn()}
        artifactsOpen={false}
        onToggleArtifacts={onToggleArtifacts}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /show artifacts pane/i }))
    expect(onToggleArtifacts).toHaveBeenCalledOnce()
  })

  it('reflects open state via aria-pressed and label', () => {
    render(
      <RoomHeader
        room={{ id: 'r1', name: 'Conference', type: 'conference' }}
        onSwitchBranch={vi.fn()}
        artifactsOpen={true}
        onToggleArtifacts={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: /hide artifacts pane/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})
