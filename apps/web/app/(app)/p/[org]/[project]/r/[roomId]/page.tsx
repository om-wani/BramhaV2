'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { ConversationNodeDto, BranchDto, PersonaScore, ValidatedCitation } from '@bramha/shared';
import type { NodeCreatedEvent, BranchCreatedEvent, NodeDeltaEvent, NodeErrorEvent, TurnSelectionEvent } from '@bramha/shared';
import { PERSONA_SLUGS } from '@bramha/shared';
import type { PersonaSlug } from '@bramha/shared';

// ---- types ----------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  createdAt: string;
}

interface RoomRow {
  id: string;
  name: string;
  kind: string;
  persona: string | null;
  createdAt: string;
}

interface CreateBranchBody {
  fromNodeId: string;
  name: string;
}

// ---- constants -------------------------------------------------------------

const PERSONA_NAMES: Record<string, string> = {
  ceo: 'Astra',
  cto: 'Vulcan',
  cmo: 'Meridian',
  cfo: 'Ledger',
  coo: 'Lyra',
  chro: 'Iris',
  cso: 'Sage',
  cdao: 'Orion',
};

const PERSONA_MENTION_LIST = [
  { slug: 'ceo', name: 'Astra', title: 'CEO' },
  { slug: 'cto', name: 'Vulcan', title: 'CTO' },
  { slug: 'cmo', name: 'Meridian', title: 'CMO' },
  { slug: 'cfo', name: 'Ledger', title: 'CFO' },
  { slug: 'coo', name: 'Lyra', title: 'COO' },
  { slug: 'chro', name: 'Iris', title: 'CHRO' },
  { slug: 'cso', name: 'Sage', title: 'CSO' },
  { slug: 'cdao', name: 'Orion', title: 'CDAO' },
] as const;

// ---- helpers ---------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---- sub-components -------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="flex gap-3 px-6 py-4 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-[hsl(var(--surface))] shrink-0 mt-0.5" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-24 rounded bg-[hsl(var(--surface))]" />
        <div className="h-3 w-full rounded bg-[hsl(var(--surface))]" />
        <div className="h-3 w-3/4 rounded bg-[hsl(var(--surface))]" />
      </div>
    </div>
  );
}

function getPersonaName(slug: string): string {
  return Object.prototype.hasOwnProperty.call(PERSONA_NAMES, slug)
    ? (PERSONA_NAMES as Record<string, string | undefined>)[slug] ?? slug
    : slug;
}

// ---- citation chip --------------------------------------------------------

function CitationChip({
  citation,
  onClick,
}: {
  citation: ValidatedCitation;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full
        bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/0.25)]
        border border-[hsl(var(--accent)/0.3)] transition-colors"
    >
      <span className="font-medium truncate max-w-[120px]">{citation.filename}</span>
      <span className="text-[hsl(var(--accent)/0.7))]">#{citation.chunkIndex}</span>
    </button>
  );
}

// ---- artifact card --------------------------------------------------------

function ArtifactCard({ artifact }: { artifact: { type: 'html'; content: string } }) {
  const [expanded, setExpanded] = useState(false);
  const srcDoc = artifact.content;

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded]);

  return (
    <div className="mt-3 rounded-lg border border-[hsl(var(--border))] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[hsl(var(--surface-raised))]
        border-b border-[hsl(var(--border))]">
        <span className="text-xs font-medium text-[hsl(var(--text-muted))]">HTML Artifact</span>
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-[hsl(var(--accent))] hover:underline"
        >
          Expand ↗
        </button>
      </div>
      {/* No allow-same-origin — sandbox enforces null origin */}
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        title="artifact"
        className="w-full h-48 border-0"
      />

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b">
              <span className="text-sm font-medium">HTML Artifact</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                ✕ Close
              </button>
            </div>
            <iframe
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              title="artifact expanded"
              className="flex-1 border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- message card ---------------------------------------------------------

function MessageCard({
  node,
  onBranchFrom,
  onCitationClick,
}: {
  node: ConversationNodeDto;
  onBranchFrom: (nodeId: string) => void;
  onCitationClick: (citation: ValidatedCitation) => void;
}) {
  const isUser = node.authorType === 'user';
  const persona = node.persona ?? null;
  const displayName = isUser ? 'You' : (persona ? getPersonaName(persona) : 'Agent');
  const initial = isUser ? 'U' : (persona ? (persona[0]?.toUpperCase() ?? 'A') : 'A');

  const avatarColor = isUser
    ? 'hsl(var(--text-muted))'
    : persona
    ? `hsl(var(--persona-${persona}))`
    : 'hsl(var(--accent))';

  const citations =
    node.authorType === 'agent' && Array.isArray(node.metadata?.citations)
      ? (node.metadata.citations as ValidatedCitation[])
      : [];

  return (
    <article className="relative group flex gap-3 px-6 py-4 hover:bg-[hsl(var(--surface)/0.4)] transition-colors">
      <button
        onClick={() => onBranchFrom(node.id)}
        className="absolute top-3 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--accent))] bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded px-2 py-0.5 whitespace-nowrap"
        aria-label={`Branch conversation from this message`}
      >
        ⑂ Branch from here
      </button>
      <div
        aria-hidden="true"
        className="w-8 h-8 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-xs font-bold text-[hsl(var(--canvas))]"
        style={{ backgroundColor: avatarColor }}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-[hsl(var(--text-primary))]">
            {displayName}
          </span>
          <time
            dateTime={node.createdAt}
            className="text-xs text-[hsl(var(--text-muted))]"
          >
            {relativeTime(node.createdAt)}
          </time>
        </div>
        <pre className="text-sm text-[hsl(var(--text-primary))] whitespace-pre-wrap break-words font-sans leading-relaxed">
          {node.content}
        </pre>
        {citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {citations.map((c, i) => (
              <CitationChip
                key={`${c.chunkId}-${i}`}
                citation={c}
                onClick={() => onCitationClick(c)}
              />
            ))}
          </div>
        )}
        {node.authorType === 'agent' &&
          typeof (node.metadata?.artifact as { type?: unknown } | undefined)?.type === 'string' && (
            <ArtifactCard artifact={node.metadata.artifact as { type: 'html'; content: string }} />
          )}
      </div>
    </article>
  );
}

// ---- branch rail ----------------------------------------------------------

function BranchRail({
  branches,
  activeBranchId,
  onSelect,
}: {
  branches: BranchDto[];
  activeBranchId: string | null;
  onSelect: (id: string) => void;
}) {
  const mainBranch = branches.find((b) => b.name === 'main');
  const forks = branches.filter((b) => b.name !== 'main');

  return (
    <aside
      aria-label="Branches"
      className="w-44 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface))] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--text-muted))]">
          Branches
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* main branch first */}
        {mainBranch && (
          <BranchItem
            branch={mainBranch}
            isActive={mainBranch.id === activeBranchId}
            indent={false}
            onSelect={onSelect}
          />
        )}

        {/* forks indented under main */}
        {forks.map((b) => (
          <BranchItem
            key={b.id}
            branch={b}
            isActive={b.id === activeBranchId}
            indent={true}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="p-2 border-t border-[hsl(var(--border))]">
        <p className="text-[10px] text-[hsl(var(--text-muted))] px-2 py-1">
          Hover a message to branch from it
        </p>
      </div>
    </aside>
  );
}

function BranchItem({
  branch,
  isActive,
  indent,
  onSelect,
}: {
  branch: BranchDto;
  isActive: boolean;
  indent: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(branch.id)}
      title={branch.name}
      className={[
        'w-full text-left px-3 py-1.5 text-xs rounded transition-colors truncate flex items-center gap-1',
        isActive
          ? 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] font-semibold'
          : 'text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--canvas))]',
        indent ? 'pl-5' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isActive ? (
        <span aria-hidden="true" className="shrink-0">●</span>
      ) : indent ? (
        <span aria-hidden="true" className="shrink-0 text-[hsl(var(--text-muted))]">├</span>
      ) : (
        <span aria-hidden="true" className="shrink-0 text-[hsl(var(--text-muted))]">○</span>
      )}
      <span className="truncate">{branch.name}</span>
    </button>
  );
}

// ---- streaming card -------------------------------------------------------

function StreamingCard({ slug, content }: { slug: PersonaSlug; content: string }) {
  const displayName = getPersonaName(slug);
  const initial = slug[0]?.toUpperCase() ?? 'A';
  const avatarColor = `hsl(var(--persona-${slug}))`;

  return (
    <article className="flex gap-3 px-6 py-4 opacity-90">
      <div
        aria-hidden="true"
        className="w-8 h-8 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-xs font-bold text-[hsl(var(--canvas))]"
        style={{ backgroundColor: avatarColor }}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-[hsl(var(--text-primary))]">
            {displayName}
          </span>
          <span className="text-xs text-[hsl(var(--text-muted))]">streaming…</span>
        </div>
        <pre className="text-sm text-[hsl(var(--text-primary))] whitespace-pre-wrap break-words font-sans leading-relaxed">
          {content}
          <span
            aria-hidden="true"
            className="inline-block w-0.5 h-4 bg-[hsl(var(--text-primary))] animate-caret ml-0.5 align-text-bottom"
          />
        </pre>
      </div>
    </article>
  );
}

// ---- council panel --------------------------------------------------------

function CouncilPanel({ scores }: { scores: PersonaScore[] }) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const hasSilent = sorted.some((s) => !s.selected);

  return (
    <aside
      aria-label="Council scores"
      className="w-48 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface))] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--text-muted))]">
          Council
        </span>
        <p className="text-[9px] text-[hsl(var(--text-muted))] mt-0.5">Last turn scores</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-1">
        {sorted.map(({ persona, score, selected }) => {
          const name = PERSONA_NAMES[persona] ?? persona;
          const pct = Math.round(score * 100);
          return (
            <div
              key={persona}
              className={`flex items-center gap-2 py-1.5 rounded px-2 ${selected ? 'bg-[hsl(var(--accent)/0.1)]' : 'opacity-40'}`}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold uppercase text-[hsl(var(--canvas))] shrink-0"
                style={{ backgroundColor: `hsl(var(--persona-${persona}))` }}
                aria-hidden="true"
              >
                {persona.slice(0, 2)}
              </div>
              <span className="text-xs flex-1 min-w-0 truncate text-[hsl(var(--text-primary))]">
                {name}
              </span>
              {selected ? (
                <span className="text-[10px] font-medium text-[hsl(var(--accent))]">{pct}%</span>
              ) : (
                <span className="text-[10px] text-[hsl(var(--text-muted))]">$0</span>
              )}
            </div>
          );
        })}
      </div>

      {hasSilent && (
        <div className="p-2 border-t border-[hsl(var(--border))]">
          <p className="text-[9px] text-[hsl(var(--text-muted))] px-2 py-1">
            Silent agents cost nothing
          </p>
        </div>
      )}
    </aside>
  );
}

// ---- create branch dialog -------------------------------------------------

function CreateBranchDialog({
  projectId,
  roomId,
  fromNodeId,
  onClose,
  onCreated,
}: {
  projectId: string;
  roomId: string;
  fromNodeId: string | null;
  onClose: () => void;
  onCreated: (branch: BranchDto) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const mutation = useMutation<BranchDto, Error, CreateBranchBody>({
    mutationFn: (body) =>
      apiFetch(`/backend/projects/${projectId}/rooms/${roomId}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (branch) => {
      onCreated(branch);
    },
    onError: (err) => {
      setError(err.message ?? 'Failed to create branch.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Branch name is required.');
      return;
    }
    if (!fromNodeId) {
      setError('No message selected to branch from. Hover a message and click ⑂.');
      return;
    }
    setError('');
    mutation.mutate({ fromNodeId, name: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = formRef.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-branch-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-2xl"
      >
        <h2
          id="create-branch-title"
          className="text-sm font-semibold text-[hsl(var(--text-primary))] mb-4"
        >
          Create branch
        </h2>

        <label htmlFor="branch-name" className="block text-xs text-[hsl(var(--text-muted))] mb-1">
          Branch name
        </label>
        <input
          id="branch-name"
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. pricing-alt"
          maxLength={80}
          className="w-full px-3 py-2 text-sm rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] mb-1"
        />

        {fromNodeId && (
          <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
            Forking from node <code className="font-mono">{fromNodeId.slice(0, 8)}…</code>
          </p>
        )}

        {error && (
          <p className="text-red-400 text-xs mb-3">{error}</p>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--canvas))] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !name.trim()}
            className="px-4 py-2 text-xs rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---- main component -------------------------------------------------------

export default function RoomPage() {
  const params = useParams<{ org: string; project: string; roomId: string }>();
  const { org: orgSlug, project: projectSlug, roomId } = params;
  const qc = useQueryClient();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [dialogFromNodeId, setDialogFromNodeId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  // Map from pending nodeId ('pending-ceo') to accumulated text
  const [streamingNodes, setStreamingNodes] = useState<Map<string, string>>(new Map());
  // Council panel scores from turn:selection
  const [personaScores, setPersonaScores] = useState<PersonaScore[]>([]);
  // @mention popover state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // citation excerpt popover
  const [activeCitation, setActiveCitation] = useState<ValidatedCitation | null>(null);

  useEffect(() => {
    if (activeCitation === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveCitation(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeCitation]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeBranchIdRef = useRef<string | null>(null);

  // ---- slug → id resolution -----------------------------------------------

  const orgsQuery = useQuery<OrgRow[]>({
    queryKey: ['orgs'],
    queryFn: () => apiFetch('/backend/orgs'),
    staleTime: 60_000,
  });

  const orgs = orgsQuery.data ?? [];
  const matchedOrg = orgs.find((o) => slugify(o.name) === orgSlug) ?? null;

  const projectsQuery = useQuery<ProjectRow[]>({
    queryKey: ['projects', matchedOrg?.id],
    queryFn: () => apiFetch(`/backend/orgs/${matchedOrg!.id}/projects`),
    enabled: matchedOrg !== null,
    staleTime: 60_000,
  });

  const projects = projectsQuery.data ?? [];
  const matchedProject = projects.find((p) => slugify(p.name) === projectSlug) ?? null;
  const projectId = matchedProject?.id ?? null;

  // ---- room info ----------------------------------------------------------

  const roomsQuery = useQuery<RoomRow[]>({
    queryKey: ['rooms', projectId],
    queryFn: () => apiFetch(`/backend/projects/${projectId}/rooms`),
    enabled: projectId !== null,
  });

  const room = (roomsQuery.data ?? []).find((r) => r.id === roomId) ?? null;

  // ---- branches -----------------------------------------------------------

  const branchesQuery = useQuery<BranchDto[]>({
    queryKey: ['branches', projectId, roomId],
    queryFn: () => apiFetch(`/backend/projects/${projectId}/rooms/${roomId}/branches`),
    enabled: projectId !== null,
  });

  const branches = branchesQuery.data ?? [];

  // Initialize activeBranchId to main once branches load
  useEffect(() => {
    if (activeBranchId !== null) return;
    const main = branches.find((b) => b.name === 'main') ?? branches[0] ?? null;
    if (main) setActiveBranchId(main.id);
  }, [branches, activeBranchId]);

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  useEffect(() => {
    activeBranchIdRef.current = activeBranchId;
  }, [activeBranchId]);

  // ---- thread -------------------------------------------------------------

  const threadQuery = useQuery<ConversationNodeDto[]>({
    queryKey: ['thread', projectId, roomId, activeBranchId],
    queryFn: () =>
      apiFetch(
        `/backend/projects/${projectId}/rooms/${roomId}/branches/${activeBranchId!}/thread`,
      ),
    enabled: projectId !== null && activeBranchId !== null,
  });

  const nodes = threadQuery.data ?? [];

  // ---- scroll to bottom on new messages or streaming updates --------------

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [nodes.length, streamingNodes]);

  // ---- Socket.IO — lifecycle (connect once per room) ----------------------

  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();
    socket.connect();
    socket.emit('room:join', { projectId, roomId });
    return () => {
      socket.emit('room:leave', { roomId });
      socket.disconnect();
    };
  }, [projectId, roomId]);

  // ---- Socket.IO — node:created handler -----------------------------------
  // Reads branch ID from live cache so it never captures a stale closure value.

  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    const handleNodeCreated = (event: NodeCreatedEvent) => {
      if (event.node.roomId !== roomId) return;
      const targetBranchId = activeBranchIdRef.current;
      if (!targetBranchId) return;
      qc.setQueryData<ConversationNodeDto[]>(
        ['thread', projectId, roomId, targetBranchId],
        (prev) => {
          if (!prev) return [event.node];
          if (prev.some((n) => n.id === event.node.id)) return prev;
          return [...prev, event.node];
        },
      );
      // Remove the pending streaming card now that the real node is persisted
      if (event.node.authorType === 'agent' && event.node.persona) {
        setStreamingNodes((prev) => {
          const next = new Map(prev);
          next.delete(`pending-${event.node.persona}`);
          return next;
        });
      }
    };

    const handleNodeDelta = (event: NodeDeltaEvent) => {
      setStreamingNodes((prev) => {
        const next = new Map(prev);
        next.set(event.nodeId, (next.get(event.nodeId) ?? '') + event.text);
        return next;
      });
    };

    const handleNodeError = (event: NodeErrorEvent) => {
      setStreamingNodes((prev) => {
        const next = new Map(prev);
        next.delete(event.nodeId);
        return next;
      });
    };

    const handleTurnSelection = (event: TurnSelectionEvent) => {
      setPersonaScores(event.scores);
    };

    socket.on('node:created', handleNodeCreated);
    socket.on('node:delta', handleNodeDelta);
    socket.on('node:error', handleNodeError);
    socket.on('turn:selection', handleTurnSelection);
    return () => {
      socket.off('node:created', handleNodeCreated);
      socket.off('node:delta', handleNodeDelta);
      socket.off('node:error', handleNodeError);
      socket.off('turn:selection', handleTurnSelection);
    };
  }, [projectId, roomId, qc]);

  // ---- Socket.IO — branch:created handler ---------------------------------

  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    const handleBranchCreated = (event: BranchCreatedEvent) => {
      if (event.branch.roomId !== roomId) return;
      void qc.invalidateQueries({ queryKey: ['branches', projectId, roomId] });
    };

    socket.on('branch:created', handleBranchCreated);
    return () => {
      socket.off('branch:created', handleBranchCreated);
    };
  }, [projectId, roomId, qc]);

  // ---- Clear streaming nodes on room/branch switch -------------------------

  useEffect(() => {
    setStreamingNodes(new Map());
  }, [roomId, activeBranchId]);

  // ---- branch dialog callbacks --------------------------------------------

  const openDialogFromNode = useCallback((nodeId: string) => {
    setDialogFromNodeId(nodeId);
    setShowDialog(true);
  }, []);

  const handleBranchCreated = useCallback(
    (branch: BranchDto) => {
      setShowDialog(false);
      void qc.invalidateQueries({ queryKey: ['branches', projectId, roomId] });
      setActiveBranchId(branch.id);
    },
    [qc, projectId, roomId],
  );

  // ---- @mention popover ---------------------------------------------------

  const filteredMentions = mentionQuery !== null
    ? PERSONA_MENTION_LIST.filter(
        (p) =>
          p.name.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
          p.slug.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
          p.title.toLowerCase().startsWith(mentionQuery.toLowerCase()),
      )
    : [];

  const insertMention = useCallback((slug: string) => {
    setDraft((prev) => prev.replace(/@\w*$/, `@${slug} `));
    setMentionQuery(null);
    textareaRef.current?.focus();
  }, []);

  // ---- send ---------------------------------------------------------------

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || !projectId || !activeBranch) return;

    setSending(true);
    setSendError('');
    try {
      await apiFetch(`/backend/projects/${projectId}/rooms/${roomId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: activeBranch.id, content }),
      });
      setDraft('');
      textareaRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSending(false);
    }
  }, [draft, projectId, roomId, activeBranch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape always closes the mention popover, even when there are no matches
    if (e.key === 'Escape' && mentionQuery !== null) {
      setMentionQuery(null);
      return;
    }
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const p = filteredMentions[mentionIndex];
        if (p) {
          e.preventDefault();
          insertMention(p.slug);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ---- derived loading/error states ---------------------------------------

  const resolving = orgsQuery.isLoading || projectsQuery.isLoading;
  const resolutionFailed =
    (!orgsQuery.isLoading && matchedOrg === null) ||
    (!projectsQuery.isLoading && matchedOrg !== null && matchedProject === null);

  const loading =
    resolving ||
    (projectId !== null && (branchesQuery.isLoading || roomsQuery.isLoading || threadQuery.isLoading));

  const error =
    resolutionFailed
      ? 'Could not find this project. It may have been deleted or the URL is wrong.'
      : threadQuery.isError
      ? 'Failed to load conversation. Please refresh.'
      : null;

  const projectBackHref = `/p/${orgSlug}/${projectSlug}`;

  return (
    <div className="flex flex-col h-screen bg-[hsl(var(--canvas))]">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
        <Link
          href={projectBackHref}
          className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] text-sm transition-colors"
          aria-label="Back to project"
        >
          ←
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-[hsl(var(--text-primary))] truncate">
            {room?.name ?? (loading ? '…' : roomId)}
          </h1>
          {matchedProject && (
            <p className="text-xs text-[hsl(var(--text-muted))] truncate">{matchedProject.name}</p>
          )}
        </div>
        {activeBranch && activeBranch.name !== 'main' && (
          <span className="text-xs text-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.1)] border border-[hsl(var(--accent)/0.3)] rounded px-2 py-0.5 shrink-0">
            ⑂ {activeBranch.name}
          </span>
        )}
      </header>

      {/* Body: council panel + thread + branch rail */}
      <div className="flex flex-1 min-h-0">
        {/* Council panel — left sidebar, council rooms only */}
        {room?.kind === 'council' && personaScores.length > 0 && (
          <CouncilPanel scores={personaScores} />
        )}

        {/* Branch rail */}
        {!resolving && branches.length > 0 && (
          <BranchRail
            branches={branches}
            activeBranchId={activeBranchId}
            onSelect={setActiveBranchId}
          />
        )}

        {/* Thread column */}
        <div className="flex flex-col flex-1 min-w-0">
          <section
            role="region"
            aria-label="Conversation thread"
            className="flex-1 overflow-y-auto"
          >
            <h2 className="sr-only">Messages</h2>

            {error && (
              <div className="px-6 py-8 text-center">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {!error && loading && (
              <div>
                {[1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {!error && !loading && nodes.length === 0 && (
              <div className="px-6 py-16 text-center">
                <p className="text-[hsl(var(--text-muted))] text-sm">
                  No messages yet. Start the conversation below.
                </p>
              </div>
            )}

            {!error && !loading && nodes.map((node) => (
              <MessageCard key={node.id} node={node} onBranchFrom={openDialogFromNode} onCitationClick={setActiveCitation} />
            ))}

            {/* Streaming agent responses — appear before finalize persists them */}
            {Array.from(streamingNodes.entries()).map(([pendingId, content]) => {
              const extracted = pendingId.startsWith('pending-') ? pendingId.slice('pending-'.length) : null;
              const slug = (PERSONA_SLUGS as readonly string[]).includes(extracted ?? '') ? (extracted as PersonaSlug) : null;
              if (!slug) return null;
              return (
                <StreamingCard key={pendingId} slug={slug} content={content} />
              );
            })}

            <div ref={bottomRef} />
          </section>

          {/* Composer */}
          <footer className="shrink-0 px-6 py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            {sendError && (
              <p className="text-red-400 text-xs mb-2">{sendError}</p>
            )}
            <div className="relative flex gap-3 items-end">
              {/* @mention popover */}
              {mentionQuery !== null && filteredMentions.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto z-10">
                  {filteredMentions.map((p, i) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => insertMention(p.slug)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[hsl(var(--canvas))] ${i === mentionIndex ? 'bg-[hsl(var(--canvas))]' : ''}`}
                    >
                      <span className="text-xs font-bold uppercase text-[hsl(var(--text-muted))] w-10">{p.slug}</span>
                      <span className="text-sm text-[hsl(var(--text-primary))]">{p.name}</span>
                      <span className="text-xs text-[hsl(var(--text-muted))] ml-auto">{p.title}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                aria-label="Message"
                placeholder="Message the council… (Enter to send, Shift+Enter for newline, @ to mention)"
                value={draft}
                onChange={(e) => {
                  const newText = e.target.value;
                  setDraft(newText);
                  const match = newText.match(/@(\w*)$/);
                  if (match) {
                    setMentionQuery(match[1] ?? '');
                    setMentionIndex(0);
                  } else {
                    setMentionQuery(null);
                  }
                }}
                onKeyDown={handleKeyDown}
                disabled={sending || !projectId || !activeBranch}
                rows={1}
                className="flex-1 resize-none px-3 py-2.5 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] text-sm leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed max-h-40 overflow-y-auto"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!draft.trim() || sending || !projectId || !activeBranch}
                className="px-4 py-2.5 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </footer>
        </div>
      </div>

      {/* Create branch dialog */}
      {showDialog && projectId && (
        <CreateBranchDialog
          projectId={projectId}
          roomId={roomId}
          fromNodeId={dialogFromNodeId}
          onClose={() => setShowDialog(false)}
          onCreated={handleBranchCreated}
        />
      )}

      {/* Citation excerpt popover */}
      {activeCitation !== null && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setActiveCitation(null)}
        >
          <div
            className="absolute bg-[hsl(var(--surface))] border border-[hsl(var(--border))]
              rounded-lg shadow-xl p-4 max-w-sm max-h-48 overflow-y-auto"
            style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium text-[hsl(var(--text-muted))] mb-2">
              {activeCitation.filename} #{activeCitation.chunkIndex}
            </p>
            <p className="text-sm leading-relaxed">{activeCitation.excerpt}</p>
          </div>
        </div>
      )}
    </div>
  );
}
