/**
 * Plan execution engine — multi-step task planning with oversight.
 * Breaks tasks into ordered steps, executes with verification, handles errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generate, parseJSON } from './ollama.mjs';
import { scoreConfidence } from './reasoning.mjs';

const PLANNER_SYSTEM = `You are a task planner. Break a task into ordered steps.
Each step must be atomic (one action), verifiable, and have a clear success criteria.
Output ONLY JSON:
{
  "plan": [
    { "id": 1, "action": "read|write|exec|verify", "description": "what to do", "target": "file or command", "depends_on": [], "verify": "how to check success" }
  ],
  "summary": "string"
}`;

export function createPlanEngine(tools, memory, callPersona, log) {
  const plansDir = path.join(tools.readFile('agent/config.json').ok ? path.dirname(path.resolve('agent/config.json')) : '.', 'memory', 'plans');
  try { fs.mkdirSync(plansDir, { recursive: true }); } catch {}

  return {
    /** Generate a plan from a task description */
    async createPlan(task, projectContext) {
      const prompt = `Task: "${task}"\n\nProject: ${projectContext}\n\nBreak this into 3-8 ordered steps. Each step should be one file create/update, one command run, or one verification check.`;
      const r = await generate({ system: PLANNER_SYSTEM, prompt });
      if (!r.ok) return { ok: false, error: r.error };
      const parsed = parseJSON(r.response);
      if (!parsed.ok || !parsed.data?.plan) return { ok: false, error: 'invalid plan' };

      const plan = {
        id: `plan-${Date.now()}`,
        task,
        steps: parsed.data.plan.map((s, i) => ({ ...s, id: i + 1, status: 'pending', result: null, startedAt: null, completedAt: null })),
        status: 'ready',
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      this.savePlan(plan);
      return { ok: true, plan };
    },

    /** Execute a plan step by step with oversight */
    async executePlan(plan, { dryRun = false, maxRetries = 3 } = {}) {
      plan.status = 'running';
      this.savePlan(plan);
      log?.('info', 'plan_start', { id: plan.id, steps: plan.steps.length, task: plan.task.slice(0, 60) });

      for (const step of plan.steps) {
        // Check dependencies
        const depsOk = step.depends_on?.every(depId => plan.steps.find(s => s.id === depId)?.status === 'done') ?? true;
        if (!depsOk) { step.status = 'blocked'; continue; }

        step.status = 'running';
        step.startedAt = new Date().toISOString();
        log?.('info', 'step_start', { step: step.id, action: step.action, desc: step.description?.slice(0, 50) });

        let success = false;
        for (let attempt = 0; attempt <= maxRetries && !success; attempt++) {
          const result = await this.executeStep(step, dryRun);
          step.result = result;

          if (result.ok) {
            success = true;
          } else if (attempt < maxRetries) {
            // Try to fix
            log?.('warn', 'step_failed', { step: step.id, attempt, error: result.error?.slice(0, 100) });
            const fixed = await this.fixStep(step, result.error, attempt);
            if (!fixed) break;
          }
        }

        step.status = success ? 'done' : 'failed';
        step.completedAt = new Date().toISOString();
        log?.('info', 'step_complete', { step: step.id, status: step.status });

        if (!success) {
          plan.status = 'failed';
          plan.failedAt = step.id;
          this.savePlan(plan);
          log?.('error', 'plan_failed', { step: step.id, task: plan.task.slice(0, 40) });
          return { ok: false, plan, failedStep: step.id };
        }
        this.savePlan(plan);
      }

      plan.status = 'completed';
      plan.completedAt = new Date().toISOString();
      this.savePlan(plan);
      log?.('info', 'plan_complete', { id: plan.id, steps: plan.steps.length });
      return { ok: true, plan };
    },

    /** Execute a single step */
    async executeStep(step, dryRun) {
      if (dryRun) return { ok: true, dryRun: true };

      switch (step.action) {
        case 'read': {
          const r = tools.readFile(step.target);
          return r.ok ? { ok: true, content: r.content?.slice(0, 200) } : { ok: false, error: `cannot read ${step.target}` };
        }
        case 'write': {
          if (!step.content) {
            // Need to generate content via LLM
            const r = await callPersona?.('implementer', `Implement: ${step.description}\nTarget file: ${step.target}`);
            if (r?.ok && r.data?.files?.[0]?.content) {
              step.content = r.data.files[0].content;
            } else return { ok: false, error: 'implementer failed to generate content' };
          }
          if (scoreConfidence({ path: step.target, content: step.content, reason: step.description }) < 30) {
            return { ok: false, error: 'low confidence' };
          }
          tools.writeFile(step.target, step.content);
          return { ok: true };
        }
        case 'exec': {
          const r = tools.exec(step.target, { timeout: 120000 });
          return r.ok ? { ok: true, output: r.output?.slice(0, 200) } : { ok: false, error: r.error?.slice(0, 500) };
        }
        case 'verify': {
          const r = tools.exec(step.target || step.verify, { timeout: 60000 });
          return { ok: r.ok, output: r.output?.slice(0, 200), error: r.ok ? null : r.error?.slice(0, 200) };
        }
        default:
          return { ok: false, error: `unknown action: ${step.action}` };
      }
    },

    /** Attempt to fix a failed step */
    async fixStep(step, error, attempt) {
      if (!callPersona) return false;
      const r = await callPersona('fixer', `Step "${step.description}" failed.\nAction: ${step.action}\nTarget: ${step.target}\nError: ${error}\nAttempt ${attempt + 1}. Fix it.`);
      if (r?.ok && r.data?.patches?.length) {
        for (const patch of r.data.patches) {
          if (scoreConfidence(patch) >= 40) tools.writeFile(patch.path, patch.content);
        }
        return true;
      }
      return false;
    },

    /** Save plan state to disk */
    savePlan(plan) { try { fs.writeFileSync(path.join(plansDir, `${plan.id}.json`), JSON.stringify(plan, null, 2)); } catch {} },

    /** Load existing plan */
    loadPlan(planId) { try { return JSON.parse(fs.readFileSync(path.join(plansDir, `${planId}.json`), 'utf8')); } catch { return null; } },

    /** Get all plans */
    listPlans() {
      try { return fs.readdirSync(plansDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(plansDir, f), 'utf8'))); } catch { return []; }
    },

    /** Get plan progress summary */
    getProgress(plan) {
      const done = plan.steps.filter(s => s.status === 'done').length;
      return { total: plan.steps.length, done, pending: plan.steps.length - done, status: plan.status, pct: Math.round((done / plan.steps.length) * 100) };
    },
  };
}
