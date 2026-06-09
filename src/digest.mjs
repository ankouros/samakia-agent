/**
 * Weekly digest — auto-generated summary of agent activity.
 */
import fs from 'node:fs';
import path from 'node:path';

export function generateDigest(memoryDir) {
  const actionsFile = path.join(memoryDir, 'actions.json');
  const buildsFile = path.join(memoryDir, 'builds.json');

  const actions = fs.existsSync(actionsFile) ? JSON.parse(fs.readFileSync(actionsFile, 'utf8')) : [];
  const builds = fs.existsSync(buildsFile) ? JSON.parse(fs.readFileSync(buildsFile, 'utf8')) : [];

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentActions = actions.filter(a => new Date(a.ts).getTime() > weekAgo);
  const recentBuilds = builds.filter(b => new Date(b.ts).getTime() > weekAgo);

  const commits = recentActions.filter(a => a.type === 'commit').length;
  const fixes = recentActions.filter(a => a.type === 'compliance_fix' || a.type === 'verification_fix').length;
  const buildsPassed = recentBuilds.filter(b => b.ok).length;
  const buildsFailed = recentBuilds.filter(b => !b.ok).length;

  return {
    period: { from: new Date(weekAgo).toISOString(), to: new Date().toISOString() },
    summary: { commits, fixes, buildsPassed, buildsFailed, totalActions: recentActions.length },
    highlights: [
      commits > 0 ? `${commits} auto-commits made` : null,
      fixes > 0 ? `${fixes} issues auto-fixed` : null,
      buildsFailed > 0 ? `${buildsFailed} build failures detected` : null,
      buildsPassed > 0 ? `${buildsPassed} successful builds` : null,
    ].filter(Boolean),
    generatedAt: new Date().toISOString(),
  };
}
