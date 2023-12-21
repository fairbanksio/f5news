const { exec } = require('child_process');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm'); // CommonJS import

console.log('deploying to s3');
// get parameter
const client = new SSMClient();
const input = {
  // GetParameterRequest
  Name: 'primary_domain_cdn', // required
  WithDecryption: true,
};
const command = new GetParameterCommand(input);
client.send(command).then(data => {
  const bucket_name = data.Parameter.Value;
  exec(`aws s3 sync build/ s3://${bucket_name}`, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout: ${stdout}`);
    console.log('deployed to s3');
  });
});

//aws s3 sync build/ s3://bsord.dev-cdn
