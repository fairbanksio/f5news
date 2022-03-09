# F5oclock

![f5oclock](https://raw.githubusercontent.com/fairbanks-io/f5oclock/master/f5oclock.gif)

![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/Client%20-%20Release?label=Client%20Build>)
![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/API%20-%20Release?label=Api%20Build>)
![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/Scraper%20-%20Release?label=Scraper%20Build>)
![GitHub top language](https://img.shields.io/github/languages/top/fairbanks-io/f5oclock.svg)
![GitHub last commit](https://img.shields.io/github/last-commit/fairbanks-io/f5oclock.svg)
![Lines of code](https://img.shields.io/tokei/lines/github/fairbanks-io/f5oclock)
![License](https://img.shields.io/github/license/fairbanks-io/f5oclock.svg?style=flat)

A MERN stack based application that scrapes subreddits and asynchronously presents it to the user.
### Prerequisites

1. MongoDB instance
2. Docker
3. Kubernetes with Ingress and Helm v3 (optional)

### Getting Started

#### Docker

- First setup the scraper service to collect Reddit posts: `docker run -d --restart=always -e MONGO_URI='mongodb://user:password@localhost/database?retryWrites=true&w=majority' --name f5oclock-scraper fairbanksio/f5oclock-scraper`
- Second, setup the api to serve posts from the database: `docker run -d --restart=always -p 4000:3000 -e MONGO_URI='mongodb://user:password@localhost/f5oclock' --name f5oclock-api fairbanksio/f5oclock-api`
- Last, fire up the frontend to view the UI: `docker run -d --restart=always -p 3000:3000 -e REACT_APP_API='https://localhost:4000' --name f5oclock-client fairbanksio/f5oclock-client`

The web client should now be available on port 3000

#### Kubernetes with Helm

This application is designed to be deployed to kubernetes using Helm v3.

1. Create kubernetes secret that contains the Mongo URI connection string for the database where posts will be stored
```sh
kubectl create secret generic f5oclock-mongouri \
 --from-literal=mongouri="mongodb+srv://USER:PASS@HOSTNAME/DATABASE_NAME?retryWrites=true&w=majority"
```
2. Add helm repo
```sh
helm repo add fairbanks-io https://fairbanks-io.github.io/helm-charts/
```
3. Install helm chart for f5oclock and specify ingress values
```sh
helm install f5oclock \
--set f5oclock-api.ingress.hosts[0].host="API_INGRESS_HOST_NAME" \
--set f5oclock-client.apiURL="https://API_INGRESS_HOST_NAME" \
--set f5oclock-client.ingress.hosts[0].host="CLIENT_INGRESS_HOST_NAME" \
fairbanks-io/f5oclock
```
