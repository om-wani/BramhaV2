import { ChatRoom } from '@/components/chat/ChatRoom'

export const metadata = { title: 'Meeting — BramhaV2' }

interface PageProps {
  params: { projectId: string; roomId: string }
}

/**
 * Meeting room page — server component.
 * Passes the specific roomId to ChatRoom so it fetches that room directly.
 */
export default function MeetingRoomPage({ params }: PageProps) {
  return (
    <div className="flex h-full flex-col">
      <ChatRoom
        projectId={params.projectId}
        roomId={params.roomId}
        roomType="meeting"
      />
    </div>
  )
}
