import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

const VALID_DEPARTMENTS = ['executive', 'development', 'marketing', 'operations', 'finance', 'support'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dept = searchParams.get('department');
  if (!dept || !VALID_DEPARTMENTS.includes(dept)) {
    return NextResponse.json({ error: 'Invalid department' }, { status: 400 });
  }

  const db = await getDb();
  if (!db) return NextResponse.json({});

  try {
    const doc = await db.collection('org_settings').findOne({ _id: `dept_${dept}` as unknown as import('mongodb').ObjectId });
    if (!doc) return NextResponse.json({});
    const { _id, ...settings } = doc;
    void _id;

    // Reverse-transform agents format back to MC form fields
    // Preserve the full agents object so model/temperature round-trip
    const { agents, ...restSettings } = settings;
    const cronStates: Record<string, unknown> = {};
    const eventStates: Record<string, unknown> = {};

    if (agents && typeof agents === 'object') {
      for (const [agentName, overrides] of Object.entries(agents as Record<string, Record<string, unknown>>)) {
        if (overrides?.cronEnabled) cronStates[agentName] = overrides.cronEnabled;
        if (overrides?.eventEnabled) eventStates[agentName] = overrides.eventEnabled;
      }
    }

    // Extract per-agent model/temperature into agentModels for MC settings forms
    const agentModels: Record<string, Record<string, unknown>> = {};
    if (agents && typeof agents === 'object') {
      for (const [agentName, overrides] of Object.entries(agents as Record<string, Record<string, unknown>>)) {
        if (overrides?.model || overrides?.temperature !== undefined) {
          agentModels[agentName] = {
            ...(overrides.model ? { model: overrides.model } : {}),
            ...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
          };
        }
      }
    }

    const result = { ...restSettings, cronStates, eventStates, agents, agentModels };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}

export async function PATCH(req: Request) {
  const { searchParams } = new URL(req.url);
  const dept = searchParams.get('department');
  if (!dept || !VALID_DEPARTMENTS.includes(dept)) {
    return NextResponse.json({ error: 'Invalid department' }, { status: 400 });
  }

  const db = await getDb();
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }
    // Strip dangerous keys that could overwrite internal fields
    const { _id, updatedAt, ...safeFields } = body as Record<string, unknown>;
    void _id; void updatedAt;

    // Transform MC form fields to canonical overlay format for core agent runtime
    const { cronStates, eventStates, ...remainingFields } = safeFields as Record<string, unknown>;

    // Read existing agents from DB to preserve model/temperature overrides
    // that MC doesn't manage yet but may have been set directly
    const existingDoc = await db.collection('org_settings').findOne({
      _id: `dept_${dept}` as unknown as import('mongodb').ObjectId,
    });
    const existingAgents = (existingDoc?.agents as Record<string, Record<string, unknown>> | undefined) ?? {};

    // Deep merge: start with existing agent data, then overlay cronEnabled/eventEnabled
    const agents: Record<string, Record<string, unknown>> = {};
    for (const [name, data] of Object.entries(existingAgents)) {
      agents[name] = { ...data };
    }
    // Also merge any agents sent from the client (future model/temp UI)
    const clientAgents = remainingFields.agents as Record<string, Record<string, unknown>> | undefined;
    if (clientAgents) {
      for (const [name, data] of Object.entries(clientAgents)) {
        agents[name] = { ...(agents[name] ?? {}), ...data };
      }
    }

    if (cronStates && typeof cronStates === 'object') {
      for (const [agentName, tasks] of Object.entries(cronStates as Record<string, unknown>)) {
        if (!agents[agentName]) agents[agentName] = {};
        agents[agentName]!.cronEnabled = tasks;
      }
    }
    if (eventStates && typeof eventStates === 'object') {
      for (const [agentName, events] of Object.entries(eventStates as Record<string, unknown>)) {
        if (!agents[agentName]) agents[agentName] = {};
        agents[agentName]!.eventEnabled = events;
      }
    }

    // Strip agents and agentModels from remainingFields since we handle them separately
    const { agents: _clientAgents, agentModels, ...fieldsWithoutAgents } = remainingFields;
    void _clientAgents;

    // Merge agent model/temperature overrides from MC settings forms
    if (agentModels && typeof agentModels === 'object') {
      for (const [agentName, overrides] of Object.entries(agentModels as Record<string, Record<string, unknown>>)) {
        if (!agents[agentName]) agents[agentName] = {};
        if (overrides?.model) agents[agentName]!.model = overrides.model;
        if (overrides?.temperature !== undefined) agents[agentName]!.temperature = overrides.temperature;
      }
    }

    const docToSave = { ...fieldsWithoutAgents, agents, updatedAt: new Date().toISOString() };

    await db.collection('org_settings').updateOne(
      { _id: `dept_${dept}` as unknown as import('mongodb').ObjectId },
      { $set: docToSave },
      { upsert: true }
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
