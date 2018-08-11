# The Original f5oclock

![f5oclock](https://raw.githubusercontent.com/jonfairbanks/f5oclock/master/f5oclock.png)
A MEAN stack based application that scrapes **r/politics/rising** and asynchronously presents it to the user.

#### Prerequisites
1. Node v8+ Recommended
2. A Previously Setup MongoDB Instance with an **f5oclock** collection and auth'd user
2. `yarn` or `npm` installed and up-to-date
3. *Optional:* `pm2` to keep the app running in the background

#### Getting Started
1. Clone the repo to **f5oclock/** or a directory of your choice.
2. Run `yarn install` to install dependencies.
3. Move to the **scripts/** directory and run `pm2 start fetchPosts.js` to fill the DB with posts.
4. Now move back to the main folder and run `pm2 start server.js` to start the front-end UI.
5. Once started, navigate to **localhost:3030** to view trending news!

###### Pull requests are welcome!