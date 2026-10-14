import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { promisify } from 'node:util';

const scripts = ['deploy-to-s3.js', 'invalidate-cache.js', 'generate-config.js'];

async function runScript(filename, { parameterError, commandError, writeError, stderr = '' } = {}) {
  const commands = [];
  const writes = [];
  const logs = [];
  const process = { exitCode: 0 };
  const module = { exports: {} };
  const require = name => {
    if (name === 'node:util') return { promisify };
    if (name === 'node:child_process') {
      const execFile = () => {};
      execFile[promisify.custom] = async (file, args) => {
        commands.push({ file, args });
        if (commandError) throw commandError;
        return { stdout: 'command output', stderr };
      };
      return { execFile };
    }
    if (name === 'node:fs/promises') return {
      writeFile: async (path, content) => {
        if (writeError) throw writeError;
        writes.push({ path, content });
      },
    };
    if (name === '@aws-sdk/client-ssm') return {
      SSMClient: class {
        async send() {
          if (parameterError) throw parameterError;
          return { Parameter: { Value: 'example.test' } };
        }
      },
      GetParameterCommand: class {},
    };
    throw new Error(`Unexpected module: ${name}`);
  };
  require.main = module;
  const context = createContext({ require, module, process, console: {
    log: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
  } });
  runInContext(readFileSync(new URL(filename, import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { commands, writes, logs, exitCode: process.exitCode };
}

for (const script of scripts) {
  test(`${script} fails when SSM rejects without doing further work`, async () => {
    const result = await runScript(script, { parameterError: new Error('SSM unavailable') });
    expect(result.exitCode).toBe(1);
    expect(result.commands).toEqual([]);
    expect(result.writes).toEqual([]);
  });
}

for (const script of scripts.slice(0, 2)) {
  test(`${script} fails when the AWS command fails`, async () => {
    const result = await runScript(script, { commandError: new Error('AWS command failed') });
    expect(result.exitCode).toBe(1);
    expect(result.logs.some(log => log.includes('AWS command failed'))).toBe(true);
    expect(result.logs.some(log => log.startsWith('Deployed') || log.startsWith('Invalidated'))).toBe(false);
  });

  test(`${script} accepts successful commands with stderr warnings`, async () => {
    const result = await runScript(script, { stderr: 'warning' });
    expect(result.exitCode).toBe(0);
    expect(result.commands[0].file).toBe('aws');
    expect(result.commands[0].args).toContain(script === 'deploy-to-s3.js' ? 's3://example.test' : 'example.test');
    expect(result.logs).toContain('warning');
  });
}

test('config generation fails on write errors', async () => {
  expect((await runScript('generate-config.js', { writeError: new Error('Permission denied') })).exitCode).toBe(1);
});

test('config generation writes an executable runtime assignment', async () => {
  const result = await runScript('generate-config.js');
  expect(result.exitCode).toBe(0);
  expect(result.writes[0].path).toBe('public/config.js');
  const browser = { window: {} };
  runInContext(result.writes[0].content, createContext(browser));
  expect(browser.window.REACT_APP_API).toBe('api.example.test');
});
