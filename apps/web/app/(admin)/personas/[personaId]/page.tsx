'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

// ── Schemas ──────────────────────────────────────────────────────────────────

const PersonaSchema = z.object({
  id: z.string(),
  scope: z.string(),
  tier: z.string(),
  slug: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  color: z.string().nullable(),
  systemPromptTpl: z.string(),
  speakProfile: z.object({
    eagerness: z.number().default(0.3),
    interruptThreshold: z.number().default(2.5),
    silenceBias: z.number().default(0),
  }).passthrough(),
  enabled: z.boolean(),
})

const ModelPolicySchema = z.object({
  id: z.string(),
  personaId: z.string(),
  tier: z.string(),
  primaryProvider: z.string(),
  primaryModel: z.string(),
  temperature: z.number(),
  maxInputTokens: z.number(),
  maxOutputTokens: z.number(),
  perTurnUsd: z.string(),
  perDayUsd: z.string(),
  promptCaching: z.boolean(),
}).nullable()

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PersonaEditorPage() {
  const { personaId } = useParams<{ personaId: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  // ── Local form state ────────────────────────────────────────────────────────
  const [systemPrompt, setSystemPrompt] = useState('')
  const [eagerness, setEagerness] = useState(0.3)
  const [verbosity, setVerbosity] = useState(0)
  const [provider, setProvider] = useState('anthropic')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [saved, setSaved] = useState(false)

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: persona, isLoading: personaLoading } = useQuery({
    queryKey: ['admin', 'personas', personaId],
    queryFn: () => api.get(`/admin/personas/${personaId}`, PersonaSchema).catch(() => null),
  })

  const { data: policy, isLoading: policyLoading } = useQuery({
    queryKey: ['admin', 'personas', personaId, 'model-policy'],
    queryFn: () => api.get(`/admin/personas/${personaId}/model-policy`, ModelPolicySchema),
  })

  // ── Sync form state when data loads ────────────────────────────────────────
  useEffect(() => {
    if (persona) {
      setSystemPrompt(persona.systemPromptTpl)
      setEagerness(persona.speakProfile.eagerness ?? 0.3)
      setVerbosity(persona.speakProfile.silenceBias ?? 0)
    }
  }, [persona])

  useEffect(() => {
    if (policy) {
      setProvider(policy.primaryProvider)
      setModel(policy.primaryModel)
      setTemperature(policy.temperature)
    }
  }, [policy])

  // ── Save mutations ──────────────────────────────────────────────────────────
  const updatePersona = useMutation({
    mutationFn: () =>
      api.patch(`/admin/personas/${personaId}`, PersonaSchema, {
        systemPromptTpl: systemPrompt,
        speakProfile: {
          eagerness,
          interruptThreshold: persona?.speakProfile.interruptThreshold ?? 2.5,
          silenceBias: verbosity,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'personas', personaId] })
    },
  })

  const updatePolicy = useMutation({
    mutationFn: () =>
      api.patch(`/admin/personas/${personaId}/model-policy`, ModelPolicySchema, {
        primaryProvider: provider,
        primaryModel: model,
        temperature,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'personas', personaId, 'model-policy'] })
    },
  })

  const handleSave = async () => {
    await Promise.all([updatePersona.mutateAsync(), updatePolicy.mutateAsync()])
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const isLoading = personaLoading || policyLoading
  const isSaving = updatePersona.isPending || updatePolicy.isPending

  if (isLoading) {
    return <div className="h-96 rounded-lg bg-muted animate-pulse" />
  }

  if (!persona) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">Persona not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
      </div>
    )
  }

  // ── Compiled preview — shows raw system prompt (persona compiler added in T5) ──
  const compiledPreview = systemPrompt

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {persona.name}
            {persona.title && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                — {persona.title}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground font-mono">{persona.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-green-500">Saved</span>
          )}
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      {/* System prompt + preview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>System Prompt Template</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full h-80 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="System prompt template…"
              aria-label="System prompt template"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Compiled Prompt Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="h-80 overflow-auto rounded-md border border-input bg-muted/30 px-3 py-2 text-xs font-mono whitespace-pre-wrap">
              {compiledPreview || '(empty)'}
            </pre>
          </CardContent>
        </Card>
      </div>

      {/* Speak profile */}
      <Card>
        <CardHeader>
          <CardTitle>Speak Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="eagerness">
              Eagerness: <span className="font-mono">{eagerness.toFixed(2)}</span>
            </Label>
            <input
              id="eagerness"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={eagerness}
              onChange={(e) => setEagerness(parseFloat(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              0 = rarely initiates, 1 = always eager to contribute
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="verbosity">
              Silence bias: <span className="font-mono">{verbosity.toFixed(2)}</span>
            </Label>
            <input
              id="verbosity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={verbosity}
              onChange={(e) => setVerbosity(parseFloat(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              0 = balanced, 1 = strongly prefers silence unless addressed
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Model policy */}
      <Card>
        <CardHeader>
          <CardTitle>Model Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="anthropic">anthropic</option>
                <option value="openai">openai</option>
                <option value="google">google</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-5"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="temperature">
              Temperature: <span className="font-mono">{temperature.toFixed(2)}</span>
            </Label>
            <input
              id="temperature"
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">0 = deterministic, 2 = very creative</p>
          </div>

          {policy && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground grid grid-cols-2 gap-2">
              <span>Max input tokens: {policy.maxInputTokens.toLocaleString()}</span>
              <span>Max output tokens: {policy.maxOutputTokens.toLocaleString()}</span>
              <span>Per-turn budget: ${policy.perTurnUsd}</span>
              <span>Daily budget: ${policy.perDayUsd}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {(updatePersona.isError || updatePolicy.isError) && (
        <p role="alert" className="text-sm text-destructive">
          Save failed. Please try again.
        </p>
      )}
    </div>
  )
}
