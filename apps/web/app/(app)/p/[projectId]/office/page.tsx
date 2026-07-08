import { CeoOffice } from '@/components/office/CeoOffice'

export const metadata = { title: "CEO's Office — BramhaV2" }

interface PageProps { params: { projectId: string } }

export default function OfficePage({ params }: PageProps) {
  return <CeoOffice projectId={params.projectId} />
}
