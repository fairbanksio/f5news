# F5oclock

<img src="f5oclock.png" width='65%'>

<!-- ![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/.github/workflows/Client%20-%20Release?label=Client%20Build>)
![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/.github/workflows/API%20-%20Release?label=API%20Build>)
![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/.github/workflows/Scraper%20-%20Release?label=Scraper%20Build>) -->
<!-- ![Lines of code](https://img.shields.io/tokei/lines/github/fairbanks-io/f5oclock) -->
![GitHub top language](https://img.shields.io/github/languages/top/fairbanks-io/f5oclock.svg)
![GitHub last commit](https://img.shields.io/github/last-commit/fairbanks-io/f5oclock.svg)
![License](https://img.shields.io/github/license/fairbanks-io/f5oclock.svg?style=flat)

A MERN stack based application that scrapes subreddits and asynchronously presents it to the user.

### Live Demo

<span style="font-size: 20px;">
    <a href="https://f5.news">F5.news</a>
</span>

### Prerequisites

1. MongoDB instance
3. Kubernetes with Ingress support and Helm v3

### Getting Started

F5oclock is designed to be deployed to Kubernetes using Helm v3.

1. Create a kubernetes secret that contains the Mongo URI connection string for the database where posts will be stored
```sh
kubectl create secret generic f5oclock-mongouri \
 --from-literal=mongouri="mongodb+srv://USER:PASS@HOSTNAME/DATABASE_NAME?retryWrites=true&w=majority"
```

2. Add Helm repository
```sh
helm repo add fairbanks-io https://fairbanks-io.github.io/helm-charts/
```

3. Install Helm chart for F5oclock and specify ingress values
```sh
helm install f5oclock \
--set f5oclock-api.ingress.hosts[0].host="API_INGRESS_HOST_NAME" \
--set f5oclock-client.apiURL="https://API_INGRESS_HOST_NAME" \
--set f5oclock-client.ingress.hosts[0].host="CLIENT_INGRESS_HOST_NAME" \
fairbanks-io/f5oclock
```