import { ChatRoom } from '@/components/chat/ChatRoom'

export const metadata = { title: 'Conference — BramhaV2' }

interface PageProps {
  params: { projectId: string }
}

/**
 * Conference room page — server component.
 * Reads the project ID from the route and hands it to the ChatRoom
 * client component which handles all data fetching and realtime logic.
 */
export default function ConferencePage({ params }: PageProps) {
  return (
    <div className="flex h-full flex-col">
      <ChatRoom projectId={params.projectId} roomType="conference" />
    </div>
  )
}
