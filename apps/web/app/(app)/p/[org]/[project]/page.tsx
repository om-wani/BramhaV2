'use client';

import { useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, uploadKnowledgeFile } from '@/lib/api';
import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';

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
  personas: string[];
  createdAt: string;
}

interface KnowledgeFileRow {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
  chunkCount: number | null;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

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

function getPersonaName(slug: string): string {
  return Object.prototype.hasOwnProperty.call(PERSONA_NAMES, slug)
    ? (PERSONA_NAMES as Record<string, string | undefined>)[slug] ?? slug
    : slug;
}

function roomAgentsLabel(room: { kind: string; persona: string | null; personas: string[] }): string {
  if (room.kind === 'council') return 'Council · all agents';
  const slugs = room.personas.length > 0 ? room.personas : room.persona ? [room.persona] : [];
  if (slugs.length === 0) return 'Custom room';
  if (slugs.length === 1) return `1-on-1 · ${getPersonaName(slugs[0]!)}`;
  if (slugs.length <= 3) return slugs.map(getPersonaName).join(', ');
  return `${slugs.length} agents`;
}

function CreateRoomDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const qc = useQueryClient();

  function toggle(slug: string) {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/backend/projects/${projectId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), personas: selected }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms', projectId] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create room.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-room-dialog-title"
        className="bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-2xl squircle p-6 w-full max-w-sm shadow-xl"
      >
        <h3
          id="create-room-dialog-title"
          className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4"
        >
          New room
        </h3>
        <div className="space-y-3 mb-4">
          <input
            autoFocus
            type="text"
            aria-label="Room name"
            placeholder="Strategy council"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] text-sm"
          />
          <fieldset>
            <legend className="text-xs text-[hsl(var(--text-muted))] mb-1.5">
              Agents in this room ({selected.length} selected)
            </legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PERSONA_NAMES).map(([slug, displayName]) => {
                const on = selected.includes(slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(slug)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      on
                        ? 'bg-[hsl(var(--accent)/0.15)] border-[hsl(var(--accent))] text-[hsl(var(--accent))]'
                        : 'bg-[hsl(var(--canvas))] border-[hsl(var(--border))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
                    }`}
                  >
                    {displayName} · {slug.toUpperCase()}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[hsl(var(--text-muted))] mt-2">
              Pick one for a focused 1-on-1, or several for a scoped mini-council. The full council
              room already exists.
            </p>
          </fieldset>
        </div>
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim() || selected.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const params = useParams<{ org: string; project: string }>();
  const { org: orgSlug, project: projectSlug } = params;
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

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

  const roomsQuery = useQuery<RoomRow[]>({
    queryKey: ['rooms', projectId],
    queryFn: () => apiFetch(`/backend/projects/${projectId}/rooms`),
    enabled: projectId !== null,
  });

  const rooms = roomsQuery.data ?? [];

  const deleteRoom = useMutation({
    mutationFn: (roomId: string) =>
      apiFetch(`/backend/projects/${projectId}/rooms/${roomId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms', projectId] }),
  });

  const filesQuery = useQuery<KnowledgeFileRow[]>({
    queryKey: ['files', projectId],
    queryFn: () => apiFetch(`/backend/projects/${projectId}/files`),
    enabled: projectId !== null,
  });
  const knowledgeFiles = filesQuery.data ?? [];

  async function handleFiles(files: FileList) {
    if (!projectId) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        await uploadKnowledgeFile(projectId, file);
      } catch {
        // best-effort per file; surfaced via the list not refreshing that entry
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['files', projectId] });
  }

  const resolving = orgsQuery.isLoading || projectsQuery.isLoading;
  const resolutionFailed =
    (!orgsQuery.isLoading && matchedOrg === null) ||
    (!projectsQuery.isLoading && matchedOrg !== null && matchedProject === null);

  if (resolving) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 rounded-lg bg-[hsl(var(--surface))] animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl bg-[hsl(var(--surface))] animate-pulse border border-[hsl(var(--border))]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (resolutionFailed) {
    return (
      <div className="p-8">
        <p className="text-red-400 text-sm">
          Project not found. It may have been deleted or the URL is wrong.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-1 text-sm text-[hsl(var(--accent))] hover:opacity-80 transition-opacity"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--text-primary))]">
            {matchedProject?.name ?? projectSlug}
          </h1>
          <p className="text-[hsl(var(--text-muted))] text-sm mt-1">
            {matchedOrg?.name} · Rooms
          </p>
        </div>
        {projectId && (
          <button
            onClick={() => setShowCreateRoom(true)}
            className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity"
          >
            New room
          </button>
        )}
      </div>

      <section aria-label="Rooms">
        <h2 className="sr-only">Rooms</h2>
        {roomsQuery.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-28 rounded-xl bg-[hsl(var(--surface))] animate-pulse border border-[hsl(var(--border))]"
              />
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <div className="border border-dashed border-[hsl(var(--border))] rounded-xl p-12 text-center">
            <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-2">
              No rooms yet
            </h3>
            <p className="text-[hsl(var(--text-muted))] text-sm mb-6 max-w-xs mx-auto">
              Create your first room to start a conversation with your AI council.
            </p>
            {projectId && (
              <button
                onClick={() => setShowCreateRoom(true)}
                className="px-5 py-2.5 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity"
              >
                Create first room
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="flex flex-col justify-between p-5 rounded-xl bg-[hsl(var(--surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--accent)/0.4)] transition-colors"
              >
                <div>
                  <h3 className="font-semibold text-[hsl(var(--text-primary))] mb-1 truncate">
                    {room.name}
                  </h3>
                  <p className="text-xs text-[hsl(var(--text-muted))] truncate">
                    {roomAgentsLabel(room)}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={`/p/${orgSlug}/${projectSlug}/r/${room.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] transition-colors"
                  >
                    Open <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                  {room.kind !== 'council' && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete room "${room.name}"? This cannot be undone.`)) {
                          deleteRoom.mutate(room.id);
                        }
                      }}
                      aria-label={`Delete room ${room.name}`}
                      title="Delete room"
                      className="p-1.5 rounded-lg text-[hsl(var(--text-muted))] hover:text-red-400 hover:bg-[hsl(var(--canvas))] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {projectId && (
              <button
                onClick={() => setShowCreateRoom(true)}
                className="flex flex-col items-center justify-center p-5 rounded-xl border border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--accent)/0.4)] hover:text-[hsl(var(--accent))] text-[hsl(var(--text-muted))] transition-colors text-sm"
              >
                <span className="text-2xl mb-2">+</span>
                New room
              </button>
            )}
          </div>
        )}
      </section>

      {/* Files section */}
      {projectId && (
        <section aria-label="Files" className="mt-10">
          <h2 className="sr-only">Files</h2>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-[hsl(var(--text-primary))]">Knowledge store</p>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 cursor-pointer text-center transition-colors ${
              dragOver
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.05)]'
                : 'border-[hsl(var(--border))]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); }}
            />
            <p className="text-sm text-[hsl(var(--text-muted))]">
              {uploading ? 'Uploading…' : 'Drop files here or click to upload (PDF, DOCX, TXT, MD, CSV · 25 MB max)'}
            </p>
          </div>

          {/* Knowledge store contents — first 4, then a link to the full list. */}
          {knowledgeFiles.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {knowledgeFiles.slice(0, 4).map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))]"
                >
                  <span className="flex-1 min-w-0 text-sm text-[hsl(var(--text-primary))] truncate">
                    {f.filename}
                  </span>
                  <span className="shrink-0 text-xs text-[hsl(var(--text-muted))]">
                    {(f.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      f.status === 'ready'
                        ? 'text-emerald-400'
                        : f.status === 'error'
                          ? 'text-red-400'
                          : 'text-[hsl(var(--text-muted))]'
                    }`}
                  >
                    {f.status === 'ready' && f.chunkCount !== null ? `${f.chunkCount} chunks` : f.status}
                  </span>
                </div>
              ))}
              {knowledgeFiles.length > 4 && (
                <Link
                  href={`/p/${orgSlug}/${projectSlug}/files`}
                  className="inline-flex items-center gap-1 text-xs text-[hsl(var(--accent))] hover:opacity-80 transition-opacity pt-1"
                >
                  View all {knowledgeFiles.length} files <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {showCreateRoom && projectId && (
        <CreateRoomDialog projectId={projectId} onClose={() => setShowCreateRoom(false)} />
      )}
    </div>
  );
}
