# The Original f5oclock

![f5oclock](https://raw.githubusercontent.com/jonfairbanks/f5oclock/master/f5oclock.png)

![Docker Cloud Automated build](https://img.shields.io/docker/cloud/automated/jonfairbanks/f5oclock.svg)
![Docker Cloud Build Status](https://img.shields.io/docker/cloud/build/jonfairbanks/f5oclock.svg)
![GitHub top language](https://img.shields.io/github/languages/top/jonfairbanks/f5oclock.svg)
![Docker Pulls](https://img.shields.io/docker/pulls/jonfairbanks/f5oclock.svg)
![GitHub last commit](https://img.shields.io/github/last-commit/jonfairbanks/f5oclock.svg)
![License](https://img.shields.io/github/license/jonfairbanks/f5oclock.svg?style=flat)

A MEAN stack based application that scrapes **r/politics/rising** and asynchronously presents it to the user.

This is what was on f5oclock.com before they switched to the UI with ads. 

#### Prerequisites
1. Node v12+ Recommended
2. A Previously Setup MongoDB Instance
3. `npm` installed and up-to-date
4. *Optional:* `pm2` to keep the app running in the background

#### Getting Started
1. Clone the repo to **f5oclock/** or a directory of your choice.
2. Run `npm install` in both client & server directories to install dependencies.
3. Pass a `MONGO_URI` env variable to overrode MongoDB details if necessary.
4. Run `pm2 start client/index.js` to fill the DB with posts.
5. Then run `pm2 start server/index.js` to start the front-end UI.
6. Once started, navigate to **localhost:3000** to view trending news!

#### Docker
This application is also available on DockerHub. To setup, run the following:

- First setup the backend service to collect posts: `docker run -d --restart=always -e MONGO_URI='mongodb://user:password@localhost/f5oclock' --name f5serv jonfairbanks/f5oclockserv`
- Last, fire up the frontend: `docker run -d --restart=always -p 3000:3000 -e MONGO_URI='mongodb://user:password@localhost/f5oclock' --name f5web jonfairbanks/f5oclockweb`

The application should now be running on Port 3000.
