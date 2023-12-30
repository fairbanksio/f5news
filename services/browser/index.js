const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
var { Readability } = require("@mozilla/readability");
var { JSDOM } = require("jsdom");

module.exports.handler = async (event) => {
  try {
    // parse event body
    const body = JSON.parse(event.body);

    // get params from json post body
    const input_url = body.url;
    const use_archive = body.use_archive ? true : false;
    let url = input_url;

    if (use_archive) {
      url = `https://archive.ph/latest/${input_url}`;
    }

    // launch chromium using puppeteer
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    // open the page in browser
    const page = await browser.newPage();
    await page.goto(url);
    const page_content = await page.content();

    // create virtual dom from html content for readability lib
    var doc = new JSDOM(page_content);

    // extract article, passing url to fix relative links
    let reader = new Readability(doc.window.document, { url: input_url });
    let article = reader.parse();

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          article: article,
          //page_content: page_content,
        },
        null,
        2
      ),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify(
        {
          error: error.message,
        },
        null,
        2
      ),
    };
  }
};
