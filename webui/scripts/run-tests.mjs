import { spawnSync } from 'node:child_process';

const forwardedArgs = process.argv
  .slice(2)
  .filter(arg => arg !== '--watchAll=false' && arg !== '--watchAll=true');

const result = spawnSync('vitest', ['run', ...forwardedArgs], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
