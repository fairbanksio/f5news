const fs = require('fs');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm'); // CommonJS import

// get parameter
const client = new SSMClient();
const input = {
  // GetParameterRequest
  Name: 'primary_domain_name', // required
  WithDecryption: true,
};
const command = new GetParameterCommand(input);
client.send(command).then(data => {
  const api_domain = `api.${data.Parameter.Value}`;
  const config = `window.REACT_APP_API="${api_domain}"`;
  try {
    fs.writeFileSync('public/config.js', config);
    console.log('config written to public/config.js');
  } catch (error) {
    console.error(error);
  }
});
