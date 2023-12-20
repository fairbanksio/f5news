const Q = require("q");
const mongoose = require("./db");
const fetch = require("node-fetch");
mongoose.Promise = Q.Promise;
const newPost = require("./models/newPost");

const imageSource = (data) => {
  if (data.preview) {
    if (data.preview.images) {
      if (data.preview.images.length > 0) {
        return data.preview.images[0].source.url.replace(/amp;/g, "");
      }
    }
  }

  if (data.is_gallery) {
    if (data.gallery_data) {
      if (data.gallery_data.items) {
        if (data.gallery_data.items.length > 0) {
          return data.media_metadata[
            data.gallery_data.items[0].media_id
          ].s.u.replace(/amp;/g, "");
        }
      }
    }
  }

  return data.thumbnail;
};

const insertNewPosts = (newPosts, subreddit) => {
  console.log("inserting new posts:", newPosts); // eslint-disable-line no-console
  let insertPromises = [];
  // Fill array with promises
  newPosts.forEach((value) => {
    insertPromises.push(
      newPost.findOneAndUpdate(
        {
          title: value.data.title,
          author: value.data.author,
          created_utc: value.data.created_utc,
        },
        {
          title: value.data.title,
          domain: value.data.domain,
          url: value.data.url,
          commentLink: value.data.permalink,
          thumbnail: imageSource(value.data),
          author: value.data.author,
          created_utc: value.data.created_utc,
          upvoteCount: value.data.ups,
          commentCount: value.data.num_comments,
          fetchedAt: new Date(),
          post_hint: value.data.post_hint,
          is_video: value.data.is_video,
          media: value.data.media,
          is_gallery: value.data.is_gallery,
          gallery_data: value.data.gallery_data,
          media_metadata: value.data.media_metadata,
          is_self: value.data.is_self,
          selftext: value.data.selftext,
          selftext_html: value.data.selftext_html,
          upvote_ratio: value.data.upvote_ratio,
          rpan_video: value.data.rpan_video,
          sub: subreddit,
        },
        { upsert: true }
      )
    );
  });

  return Q.all(insertPromises)
    .catch((e) => {
      console.warn(`Error Inserting Posts @ ${Date.now()}: ${e}`); // eslint-disable-line no-console
    })
    .fin(() => {
      insertPromises = null;
    })
    .done(() => {
      insertPromises = null;
    });
};

module.exports.fetchPosts = async (event) => {
  console.log(event);
  const subreddit = event.subreddit || "politics";
  const redditUrl = `https://www.reddit.com/r/${subreddit}/rising.json`;
  console.log(redditUrl);

  await mongoose.connect();
  var headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  // reddit api auth
  var username = "f5news";
  var password = "";

  var details = {
    username: username,
    password: password,
    grant_type: "password",
  };
  var formBody = [];
  for (var property in details) {
    var encodedKey = encodeURIComponent(property);
    var encodedValue = encodeURIComponent(details[property]);
    formBody.push(encodedKey + "=" + encodedValue);
  }
  formBody = formBody.join("&");

  await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Authorization: "Basic " + btoa(username + ":" + password),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: formBody,
  })
    .then((response) => {
      return response.json();
    })
    .then((json) => {
      console.log("json", json);
    });

  await fetch(redditUrl, { method: "GET", headers: headers })
    .then((response) => {
      console.log("response", response);
      console.log("response", response.body);
      return response.json();
    })
    .then((json) => {
      console.log("json", json);
      return json.data.children;
    })
    .then((posts) => {
      console.log("posts", posts);
      return insertNewPosts(posts, subreddit);
    })
    .then(
      console.log(`Saved New Posts @ ${Date.now()}`), // eslint-disable-line no-console
      console.log(
        `Currently using ${(
          process.memoryUsage().heapUsed /
          1024 /
          1024
        ).toFixed(2)} MB of memory \n`
      ) // eslint-disable-line no-console)
    )
    .catch((error) => {
      console.log("Error fetching posts:", error);
    });
};
