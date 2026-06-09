/**
 * Inter-agent messaging — send/receive messages between per-repo agents.
 */
import fs from 'node:fs';
import path from 'node:path';

export function createMessaging(agentDir, repoName) {
  const inboxDir = path.join(agentDir, 'inbox');
  const outboxDir = path.join(agentDir, 'outbox');
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(outboxDir, { recursive: true });

  return {
    /** Send message to another repo's agent inbox */
    send(targetRepoPath, message) {
      const targetInbox = path.join(targetRepoPath, 'agent', 'inbox');
      if (!fs.existsSync(targetInbox)) return { ok: false, error: 'target inbox not found' };
      const id = `msg-${repoName}-${Date.now()}`;
      const msg = { id, from: repoName, ts: new Date().toISOString(), ...message };
      fs.writeFileSync(path.join(targetInbox, `${id}.json`), JSON.stringify(msg, null, 2));
      return { ok: true, id };
    },

    /** Read all messages in inbox */
    receive() {
      return fs.readdirSync(inboxDir).filter(f => f.startsWith('msg-')).map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8')); } catch { return null; }
      }).filter(Boolean);
    },

    /** Acknowledge (delete) a processed message */
    ack(msgId) {
      const file = path.join(inboxDir, `${msgId}.json`);
      if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
      return false;
    },

    /** Notify dependents about a breaking change */
    notifyDependents(dependentRepoPaths, change) {
      const results = [];
      for (const repoPath of dependentRepoPaths) {
        results.push(this.send(repoPath, { type: 'breaking_change', change }));
      }
      return results;
    },
  };
}
