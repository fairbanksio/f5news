# The Original f5oclock

![f5oclock](https://raw.githubusercontent.com/fairbanks-io/f5oclock/master/f5oclock.gif)

![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/Create%20Client%20Release(s)?label=Client%20Build>)
![GitHub Workflow Status](<https://img.shields.io/github/workflow/status/fairbanks-io/f5oclock/Create%20Server%20Release(s)?label=Server%20Build>)
![GitHub top language](https://img.shields.io/github/languages/top/fairbanks-io/f5oclock.svg)
![Docker Pulls](https://img.shields.io/docker/pulls/fairbanks-io/f5oclockweb.svg)
![GitHub last commit](https://img.shields.io/github/last-commit/fairbanks-io/f5oclock.svg)
![Lines of code](https://img.shields.io/tokei/lines/github/fairbanks-io/f5oclock)
![License](https://img.shields.io/github/license/fairbanks-io/f5oclock.svg?style=flat)

A MERN stack based application that scrapes subreddits and asynchronously presents it to the user.
#### Prerequisites

1. Node v16+ Recommended
2. A Previously Setup MongoDB Instance
3. `npm` installed and up-to-date
4. _Optional:_ `pm2` to keep the app running in the background

#### Getting Started

1. Clone the repo to **f5oclock/** or a directory of your choice.
2. Run `npm install` in client and api directories.
3. Pass a `MONGO_URI` env variable to overrode MongoDB details if necessary.
4. Run `pm2 start scraper/index.js` to fill the DB with posts.
5. Then run `pm2 start client/index.js` to start the front-end UI.
6. Once started, navigate to **localhost:3000** to view trending news!

#### Docker

This application is also available on DockerHub. To setup, run the following:

- First setup the scraper service to collect Reddit posts: `docker run -d --restart=always -e MONGO_URI='mongodb://user:password@localhost/f5oclock' --name f5oclock-scraper fairbanksio/f5oclock-scraper`
- Second, setup the api to serve posts from the database: `docker run -d --restart=always -p 3000:3000 -e MONGO_URI='mongodb://user:password@localhost/f5oclock' --name f5oclock-api fairbanksio/f5oclock-api`
- Last, fire up the frontend to view the UI: `docker run -d --restart=always -e REACT_APP_API='https://url-of-api-server' --name f5oclock-client fairbanksio/f5oclock-client`

The web client should now be available on port 3000
