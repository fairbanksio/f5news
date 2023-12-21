const { exec } = require('child_process');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm'); // CommonJS import

console.log('invalidating cache');
// get parameter
const client = new SSMClient();
const input = {
  // GetParameterRequest
  Name: 'primary_domain_cdn_distribution', // required
  WithDecryption: true,
};
const command = new GetParameterCommand(input);
client.send(command).then(data => {
  const distribution_id = data.Parameter.Value;
  exec(
    `aws cloudfront create-invalidation --distribution-id ${distribution_id} --paths "/*"`,
    (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
      console.log('invalidated cache');
    }
  );
});

//aws cloudfront create-invalidation --distribution-id
