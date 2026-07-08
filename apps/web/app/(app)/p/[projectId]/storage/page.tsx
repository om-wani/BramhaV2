import { StorageRoom } from '@/components/storage/StorageRoom'

export const metadata = { title: 'Storage Room — BramhaV2' }

interface PageProps {
  params: { projectId: string }
}

export default function StoragePage({ params }: PageProps) {
  return <StorageRoom projectId={params.projectId} />
}
