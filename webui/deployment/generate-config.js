const { writeFile } = require('node:fs/promises');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

async function generateConfig() {
  const client = new SSMClient();
  const { Parameter } = await client.send(new GetParameterCommand({
    Name: 'primary_domain_name',
    WithDecryption: true,
  }));
  const apiDomain = `api.${Parameter.Value}`;
  await writeFile('public/config.js', `window.REACT_APP_API=${JSON.stringify(apiDomain)};\n`);
  console.log('Config written to public/config.js.');
}

module.exports = { generateConfig };

if (require.main === module) {
  generateConfig().catch(error => {
    console.error('Config generation failed:', error.message);
    process.exitCode = 1;
  });
}
