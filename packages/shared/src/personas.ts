export const PERSONA_SLUGS = [
  'ceo',
  'cto',
  'cmo',
  'cfo',
  'coo',
  'chro',
  'cso',
  'cdao',
] as const;

export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

export interface PersonaMeta {
  slug: PersonaSlug;
  name: string;
  title: string;
  domain: string;
}

export const PERSONA_META: Record<PersonaSlug, PersonaMeta> = {
  ceo: {
    slug: 'ceo',
    name: 'Astra',
    title: 'CEO',
    domain: 'Vision, strategy, prioritization, fundraising, trade-off arbitration',
  },
  cto: {
    slug: 'cto',
    name: 'Vulcan',
    title: 'CTO',
    domain:
      'Architecture, infrastructure, technical feasibility, build-vs-buy, latency, scaling',
  },
  cmo: {
    slug: 'cmo',
    name: 'Meridian',
    title: 'CMO',
    domain: 'Brand, positioning, growth channels, messaging, launch',
  },
  cfo: {
    slug: 'cfo',
    name: 'Ledger',
    title: 'CFO',
    domain: 'Unit economics, runway, pricing, forecasts, financial risk',
  },
  coo: {
    slug: 'coo',
    name: 'Lyra',
    title: 'COO',
    domain: 'Operations, process, execution cadence, vendor management',
  },
  chro: {
    slug: 'chro',
    name: 'Iris',
    title: 'CHRO',
    domain: 'Hiring, org design, culture, compensation, retention',
  },
  cso: {
    slug: 'cso',
    name: 'Sage',
    title: 'CSO',
    domain: 'Security, compliance, privacy, threat modeling, trust',
  },
  cdao: {
    slug: 'cdao',
    name: 'Orion',
    title: 'CDAO',
    domain: 'Data strategy, analytics, metrics, ML, experimentation',
  },
};
