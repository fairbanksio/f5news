1. `cd infrastructure`
2. `terraform login` (you can get token from link provided in output from this command)
3. `terraform init`
4. `terraform plan`
5. `terraform apply` You need to update the name servers to the NS records in the new zone created in order for the cert validation records to succeed, they will stay pending for many minutes or time out until this is done. If it times out, that's fine just run apply again.
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

notes:
running terraform destroy then quickly running terraform apply to 'rebuild' may fail because it takes aws a long time to free up the s3 bucket name as it ahs to be globally unique. if you do this, you will have to change the s3 cdn name in terraform main.tf when doing apply or wait an indeterminant amount of time if you want to use the same name
