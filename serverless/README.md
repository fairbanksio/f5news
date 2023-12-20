1. cd infrastructure
2. terraform login (you can get token from link provided in output from this command)
3. terraform init
4. terraform plan
5. terraform apply
6. login to aws using sharedcluster@gmail.com and go to account>security credentials>create access key
7. cd ../webui
8. aws configure
9. MAKE SURE TO SPECIFY US-EAST-1 (or the same region defined in default terraform aws provider)
10. npm install
11. npm run generate-config
12. npm run deploy
13. cd ../services/scraper
14. npm install
15. sls deploy
16. cd ../services/posts
17. npm install
18. sls deploy
19. cd ../services/subreddits
20. npm install
21. sls deploy
