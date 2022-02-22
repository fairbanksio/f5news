# f5-get-posts
Serverless function to return posts from MongoDB in JSON format. 


# Manually run with openfaas-cli
```sh
faas-cli deploy --image=bsord/f5-get-posts --name=f5-get-posts --gateway=https://fn.yourfqdn.tld --env=MONGO_URI=mongodbstringurihere
```
## TODOS
 - [ ] Create function for getting posts from database
 - [x] Update Readme on how to deploy by hand with faas-cli
 - [x] Automate build and versioning