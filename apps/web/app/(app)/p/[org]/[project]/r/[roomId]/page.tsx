'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { ConversationNodeDto, BranchDto } from '@bramha/shared';
import type { NodeCreatedEvent, BranchCreatedEvent } from '@bramha/shared';

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

function MessageCard({
  node,
  onBranchFrom,
}: {
  node: ConversationNodeDto;
  onBranchFrom: (nodeId: string) => void;
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
      </div>
    </article>
  );
}

// ---- branch rail ----------------------------------------------------------

function BranchRail({
  branches,
  activeBranchId,
  onSelect,
  onCreateFromNode,
}: {
  branches: BranchDto[];
  activeBranchId: string | null;
  onSelect: (id: string) => void;
  onCreateFromNode: () => void;
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
        <button
          onClick={onCreateFromNode}
          className="w-full text-left text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--accent))] px-2 py-1.5 rounded hover:bg-[hsl(var(--canvas))] transition-colors"
        >
          ＋ Branch from here
        </button>
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
    if (e.key === 'Escape') onClose();
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
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-2xl"
      >
        <h2
          id="create-branch-title"
          className="text-sm font-semibold text-[hsl(var(--text-primary))] mb-4"
        >
          Create branch
        </h2>

        <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">
          Branch name
        </label>
        <input
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // ---- scroll to bottom on new messages -----------------------------------

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [nodes.length]);

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
      const liveBranches = qc.getQueryData<BranchDto[]>(['branches', projectId, roomId]);
      const liveBranchId =
        liveBranches?.find((b) => b.name === 'main')?.id ?? liveBranches?.[0]?.id;
      if (!liveBranchId) return;
      qc.setQueryData<ConversationNodeDto[]>(
        ['thread', projectId, roomId, liveBranchId],
        (prev) => {
          if (!prev) return [event.node];
          if (prev.some((n) => n.id === event.node.id)) return prev;
          return [...prev, event.node];
        },
      );
    };

    socket.on('node:created', handleNodeCreated);
    return () => {
      socket.off('node:created', handleNodeCreated);
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

  // ---- branch dialog callbacks --------------------------------------------

  const openDialogFromNode = useCallback((nodeId: string) => {
    setDialogFromNodeId(nodeId);
    setShowDialog(true);
  }, []);

  const openDialogNoNode = useCallback(() => {
    setDialogFromNodeId(null);
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

      {/* Body: branch rail + thread */}
      <div className="flex flex-1 min-h-0">
        {/* Branch rail */}
        {!resolving && branches.length > 0 && (
          <BranchRail
            branches={branches}
            activeBranchId={activeBranchId}
            onSelect={setActiveBranchId}
            onCreateFromNode={openDialogNoNode}
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
              <MessageCard key={node.id} node={node} onBranchFrom={openDialogFromNode} />
            ))}

            <div ref={bottomRef} />
          </section>

          {/* Composer */}
          <footer className="shrink-0 px-6 py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            {sendError && (
              <p className="text-red-400 text-xs mb-2">{sendError}</p>
            )}
            <div className="flex gap-3 items-end">
              <textarea
                ref={textareaRef}
                aria-label="Message"
                placeholder="Message the council… (Enter to send, Shift+Enter for newline)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
    </div>
  );
}
