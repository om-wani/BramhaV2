import { RoomPlaceholder } from '../components/room-placeholder'

export const metadata = { title: 'Conference — BramhaV2' }

export default function ConferencePage() {
  return (
    <RoomPlaceholder
      icon="🏛"
      name="Conference Room"
      description="The conference room is quiet. Say something to convene your council."
    />
  )
}
