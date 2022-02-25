#  F5oclock-list-subs
Serverless function to return list of unique subs from mongodb in JSON format. 


# Manually run with openfaas-cli
```sh
faas-cli deploy --image=fairbanksio/f5oclock-list-subs --name=f5oclock-list-subs --gateway=https://fn.yourfqdn.tld --env=MONGO_URI=mongodbstringurihere
```
## TODOS
 - [ ] Create function for getting unique subs from database
 - [ ] Automate build and versioning