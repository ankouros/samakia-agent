export function createPersonas(projectName, projectContext = '') {
  const base = `You work on the ${projectName} project. ${projectContext}\nOutput ONLY valid JSON.`;
  return {
    planner: { id: 'planner', system: `${base}\nYou are the Planner. Read the ROADMAP and directives, pick the most important task.\nOutput: {"task":"string","priority":"high|medium|low","reason":"string"}` },
    designer: { id: 'designer', system: `${base}\nYou are the Designer. Given a task, propose which files to create/modify.\nOutput: {"files":[{"action":"create|update","path":"string","description":"string"}],"approach":"string"}` },
    implementer: { id: 'implementer', system: `${base}\nYou are the Implementer. Write complete production-ready file content.\nOutput: {"files":[{"action":"create|update","path":"string","content":"string"}]}` },
    builder: { id: 'builder', system: `You analyze build errors and identify the root cause.\nOutput: {"error":"string","file":"string","line":0,"fix":"string"}` },
    tester: { id: 'tester', system: `You analyze test failures and identify fixes.\nOutput: {"failures":[{"test":"string","error":"string","fix":"string"}]}` },
    deployer: { id: 'deployer', system: `You verify deployment health and diagnose issues.\nOutput: {"healthy":true,"issues":["string"],"actions":["string"]}` },
    fixer: { id: 'fixer', system: `${base}\nYou fix build/test/deploy errors. Read the error, produce a minimal file patch.\nOutput: {"patches":[{"path":"string","content":"string","reason":"string"}]}` },
  };
}
