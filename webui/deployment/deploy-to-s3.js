const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const runCommand = promisify(execFile);

async function uploadToS3() {
  const client = new SSMClient();
  const { Parameter } = await client.send(new GetParameterCommand({
    Name: 'primary_domain_cdn',
    WithDecryption: true,
  }));
  const { stdout, stderr } = await runCommand('aws', [
    's3', 'sync', 'build/', `s3://${Parameter.Value}`,
  ]);
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  console.log('Deployed to S3.');
}

module.exports = { uploadToS3 };

if (require.main === module) {
  uploadToS3().catch(error => {
    console.error('S3 upload failed:', error.message);
    process.exitCode = 1;
  });
}
