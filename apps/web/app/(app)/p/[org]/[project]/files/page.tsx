'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { ArrowLeft, X } from 'lucide-react';
import type { FileDto, FileStatus } from '@bramha/shared';
import type { FileStatusEvent } from '@bramha/shared';

// ---- helpers ---------------------------------------------------------------

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

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ---- StatusBadge -----------------------------------------------------------

function StatusBadge({ status }: { status: FileStatus }) {
  const colors: Record<FileStatus, string> = {
    pending: 'bg-yellow-500/20 text-yellow-600',
    processing: 'bg-blue-500/20 text-blue-600',
    ready: 'bg-green-500/20 text-green-600',
    error: 'bg-red-500/20 text-red-600',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[status]}`}>
      {status}
    </span>
  );
}

// ---- Page ------------------------------------------------------------------

export default function FilesPage() {
  const params = useParams<{ org: string; project: string }>();
  const { org: orgSlug, project: projectSlug } = params;

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileDto | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Resolve org → project → projectId
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

  // Files query with polling
  const filesQuery = useQuery<FileDto[]>({
    queryKey: ['files', projectId],
    queryFn: () => apiFetch(`/backend/projects/${projectId}/files`),
    enabled: projectId !== null,
    refetchInterval: 5_000,
  });

  // Live file:status via socket
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.emit('project:join', { projectId });

    function onFileStatus(event: FileStatusEvent) {
      if (event.type !== 'file:status') return;
      queryClient.setQueryData<FileDto[]>(['files', projectId], (prev) => {
        if (!prev) return prev;
        return prev.map((f) =>
          f.id === event.fileId ? { ...f, status: event.status } : f,
        );
      });
      // Also invalidate to get fresh chunkCount when status becomes ready
      if (event.status === 'ready') {
        queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      }
    }

    socket.on('file:status', onFileStatus);
    return () => {
      socket.off('file:status', onFileStatus);
    };
  }, [projectId, queryClient]);

  async function handleFiles(files: FileList) {
    if (!projectId) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      await fetch(`/backend/projects/${projectId}/files`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['files', projectId] });
  }

  async function handleDelete(fileId: string) {
    if (!projectId) return;
    await fetch(`/backend/projects/${projectId}/files/${fileId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    queryClient.invalidateQueries({ queryKey: ['files', projectId] });
    setSelectedFile((prev) => (prev?.id === fileId ? null : prev));
  }

  const resolving = orgsQuery.isLoading || projectsQuery.isLoading;
  const resolutionFailed =
    (!orgsQuery.isLoading && matchedOrg === null) ||
    (!projectsQuery.isLoading && matchedOrg !== null && matchedProject === null);

  if (resolving) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 rounded-lg bg-[hsl(var(--surface))] animate-pulse mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-[hsl(var(--surface))] animate-pulse border border-[hsl(var(--border))]"
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

  const files = filesQuery.data ?? [];

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Link
            href={`/p/${orgSlug}/${projectSlug}`}
            className="text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            {matchedProject?.name ?? projectSlug}
          </Link>
          <span className="text-[hsl(var(--text-muted))] text-sm">/</span>
          <span className="text-sm text-[hsl(var(--text-primary))] font-medium">Files</span>
        </div>
        <h1 className="text-2xl font-bold text-[hsl(var(--text-primary))]">Knowledge store</h1>
        <p className="text-[hsl(var(--text-muted))] text-sm mt-1">
          Uploaded files are chunked and indexed for RAG — agents will cite them automatically.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 cursor-pointer text-center transition-colors mb-8 ${
          dragOver
            ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.05)]'
            : 'border-[hsl(var(--border))] hover:border-[hsl(var(--accent)/0.4)]'
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
          {uploading
            ? 'Uploading…'
            : 'Drop files here or click to upload (PDF, DOCX, TXT, MD, CSV · 25 MB max)'}
        </p>
      </div>

      {/* File list + side panel */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <section aria-label="File list">
            <h2 className="sr-only">File list</h2>
            {filesQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-lg bg-[hsl(var(--surface))] animate-pulse border border-[hsl(var(--border))]"
                  />
                ))}
              </div>
            ) : files.length === 0 ? (
              <div className="border border-dashed border-[hsl(var(--border))] rounded-xl p-12 text-center">
                <p className="text-[hsl(var(--text-muted))] text-sm">
                  No files uploaded yet. Drop files above to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => file.status === 'ready' && setSelectedFile(file)}
                    className={`flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border))] transition-colors ${
                      file.status === 'ready'
                        ? 'cursor-pointer hover:border-[hsl(var(--accent)/0.4)]'
                        : ''
                    } ${
                      selectedFile?.id === file.id
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.05)]'
                        : 'bg-[hsl(var(--surface))]'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
                        {file.filename}
                      </p>
                      <p className="text-xs text-[hsl(var(--text-muted))]">
                        {(file.sizeBytes / 1024).toFixed(0)} KB · {file.mimeType}
                      </p>
                    </div>
                    <StatusBadge status={file.status} />
                    {file.status === 'ready' && file.chunkCount !== null && (
                      <span className="text-xs text-[hsl(var(--text-muted))] shrink-0">
                        {file.chunkCount} chunks
                      </span>
                    )}
                    {file.status === 'error' && file.errorMsg && (
                      <span className="text-xs text-red-400 truncate max-w-[120px]" title={file.errorMsg}>
                        {file.errorMsg}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(file.id); }}
                      className="text-xs text-[hsl(var(--text-muted))] hover:text-red-500 transition-colors shrink-0"
                      aria-label={`Delete ${file.filename}`}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Chunk side panel */}
        {selectedFile && (
          <aside
            className="w-64 shrink-0 border border-[hsl(var(--border))] rounded-lg p-4 self-start"
            aria-label="File details"
          >
            <div className="flex justify-between items-start mb-3">
              <p className="text-sm font-medium text-[hsl(var(--text-primary))] truncate pr-2">
                {selectedFile.filename}
              </p>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors shrink-0"
                aria-label="Close panel"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs text-[hsl(var(--text-muted))]">
              {selectedFile.chunkCount ?? 0} chunks indexed
            </p>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-2">
              Agents cite as{' '}
              <code className="bg-[hsl(var(--canvas))] px-1 rounded text-[10px]">
                [Source: {selectedFile.filename} #n]
              </code>
            </p>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-3">
              {(selectedFile.sizeBytes / 1024).toFixed(0)} KB · {selectedFile.mimeType}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
