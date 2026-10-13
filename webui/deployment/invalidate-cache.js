const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const runCommand = promisify(execFile);

async function invalidateCache() {
  const client = new SSMClient();
  const { Parameter } = await client.send(new GetParameterCommand({
    Name: 'primary_domain_cdn_distribution',
    WithDecryption: true,
  }));
  const { stdout, stderr } = await runCommand('aws', [
    'cloudfront', 'create-invalidation', '--distribution-id', Parameter.Value,
    '--paths', '/*',
  ]);
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  console.log('Invalidated cache.');
}

module.exports = { invalidateCache };

if (require.main === module) {
  invalidateCache().catch(error => {
    console.error('Cache invalidation failed:', error.message);
    process.exitCode = 1;
  });
}
