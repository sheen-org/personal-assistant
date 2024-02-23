const { processGithubCommits } = require("./modules/github/commits");
const { processScreenVideos } = require("./modules/screen/upload");

require("dotenv").config();

processScreenVideos();
processGithubCommits();
