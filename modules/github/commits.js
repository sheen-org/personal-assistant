const axios = require("axios");

const processGithubCommits = async () => {
  try {
    const repositories = process.env.GITHUB_REPOSITORIES.split(",");
    console.log("[Commits] Processing Github Commits...");
    const now = new Date();
    const nowInUTC = now.toUTCString();

    const oneHourAgo = new Date();
    oneHourAgo.setHours(now.getHours() - 1);
    const oneHourAgoInUTC = oneHourAgo.toUTCString();

    const commitResults = [];

    await Promise.all(
      repositories.map(async (repo) => {
        const url = `https://api.github.com/repos/${repo}/commits?author=${process.env.GITHUB_EMAIL}&since=${oneHourAgoInUTC}&until=${nowInUTC}`;
        const axiosInstance = new axios.Axios({
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        const response = await axiosInstance.get(url);
        const data = JSON.parse(response.data);
        data.forEach((entry) => {
          commitResults.push({
            htmlUrl: entry.html_url,
            message: entry.commit.message,
            date: new Date(entry.commit.author.date).toLocaleString(),
            repository: repo,
          });
        });
      })
    );

    // send to memory store
    if (commitResults.length) {
      console.log(`[Commits] Uploading ${commitResults.length} Results`);
      await axios.post(
        "https://api.airops.com/public_api/airops_apps/d9a0cc47-475c-4601-8ef0-08416f1d57ab/execute",
        {
          inputs: {
            activities: commitResults,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.PLATFORM_AUTH_SECRET}`,
          },
        }
      );

      console.log("[Commits] upload success");
    }

    console.log("[Commits] No commits uploaded.");
  } catch (err) {
    setTimeout(() => {
      processGithubCommits();
    }, +process.env.GITHUB_COMMITS_PROCESSING_INTERVAL_IN_MS);
  }
};

module.exports = { processGithubCommits };
