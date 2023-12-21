1. `cd infrastructure`
2. `terraform login` (you can get token from link provided in output from this command)
3. `terraform init`
4. `terraform plan`
5. `terraform apply`
6. `cd ../webui`
7. login to aws using sharedcluster@gmail.com and go to account>security credentials>create access key
8. `aws configure` MAKE SURE TO SPECIFY US-EAST-1 (or the same region defined in default terraform aws provider) the region you define here is where the client and services will be deployed to and it's important it's the same as what's defined in the terraform main.tf aws providers definition
9. `npm install`
10. `npm run generate-config`
11. `npm run deploy`
12. `cd ../services/scraper`
13. `npm install`
14. `sls deploy` This might fail the first time as it creates the domain name on the first run.
15. `cd ../services/posts`
16. `npm install`
17. `sls deploy`
18. `cd ../services/subreddits`
19. `npm install`
20. `sls deploy`
