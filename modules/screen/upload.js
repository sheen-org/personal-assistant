const path = require("path");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const FormData = require("form-data");
const fs = require("fs");
const { promisify } = require("util");

const promisifiedReadDir = promisify(fs.readdir);
const promisifiedUnlink = promisify(fs.unlink);
const promisifiedStat = promisify(fs.stat);

let lastFileSize = {};

const uploadFile = async (filePath) => {
  try {
    console.log("UPLOADING", filePath);
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    const response = await axios.post(process.env.ASSET_UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.PLATFORM_AUTH_SECRET}`,
      },
    });

    console.log(
      `Uploaded ${filePath}: status ${
        response.status
      } with data: ${JSON.stringify(response.data)}`
    );

    return response.data.id;
  } catch (error) {
    console.error(`Error uploading ${filePath}:`, error);
    throw error;
  }
};

const processByNotetaker = async (id, birthtime) => {
  try {
    const response = await axios.post(
      "https://app.airops.com/public_api/airops_apps/06446e95-e4e9-4b98-9964-c91792c77356/execute",
      {
        inputs: {
          media_recording: id,
          recording_date: birthtime.toLocaleString(),
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PLATFORM_AUTH_SECRET}`,
        },
      }
    );
    console.info(
      "NOTETAKER PROCESSED SUCCESSFULY",
      JSON.stringify(response.data)
    );
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const formatDate = (date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}-${minutes}-${seconds}`;
};

const extractFrames = (videoPath, intervalInSeconds, birthtime) =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      const frames = [];
      if (err) {
        console.error("Error getting video metadata:", err);
        reject(err);
        return;
      }

      const duration = metadata.format.duration;
      const frameCount = Math.floor(duration / intervalInSeconds);
      const startOffset = 10;
      let framesCompleted = 0;

      for (let i = 0; i <= frameCount; i++) {
        const frameDate = new Date(birthtime.getTime());

        frameDate.setSeconds(
          frameDate.getSeconds() + i * intervalInSeconds + startOffset
        );

        const outputPath = path.join(
          process.env.SCREEN_SCREENSHOTS_FOLDER_PATH,
          `frame_at_${formatDate(frameDate)}.png`
        );

        console.log("WRITING SCREENSHOT TO", outputPath);

        ffmpeg(videoPath)
          .seekInput(i * intervalInSeconds + startOffset)
          .output(outputPath)
          .outputOptions("-vframes", "1")
          .on("end", () => {
            console.log(`Outputted frame to ${outputPath}`);
            framesCompleted += 1;
            frames.push({
              path: outputPath,
              datetime: frameDate.toLocaleString(),
            });

            if (framesCompleted >= frameCount) {
              resolve(frames);
            }
          })
          .run();
      }
    });
  });

const processByVisualNotetaker = (frames) => {
  return Promise.all(
    frames.map(async (frame) => {
      try {
        const assetId = await uploadFile(frame.path);
        await axios.post(
          "https://app.airops.com/public_api/airops_apps/6d2625f4-89bd-4d66-84cf-79090fd6a0b5/execute",
          {
            inputs: {
              screen_image: assetId,
              date: frame.datetime,
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.PLATFORM_AUTH_SECRET}`,
            },
          }
        );

        console.info("SUCCESSFUL EXECUTION OF VISUAL NOTETAKER FOR", frame);
      } catch (err) {
        console.error(err);
        throw err;
      }
    })
  );
};

const processScreenVideos = async () => {
  try {
    const files = await promisifiedReadDir(
      process.env.SCREEN_VIDEOS_FOLDER_PATH
    );

    console.log("[Screen Upload] Processing screen...");

    for (let file of files) {
      if (path.extname(file) === ".mp4") {
        // change this if you have different video formats
        const filePath = path.join(SCREEN_VIDEOS_FOLDER_PATH, file);
        const fileStat = await promisifiedStat(filePath);
        const fileSize = fileStat.size;

        // only process if file size has stabilized
        if (!lastFileSize[filePath] || lastFileSize[filePath] !== fileSize) {
          lastFileSize[filePath] = fileSize;
          continue;
        }

        const frames = await extractFrames(filePath, 300, fileStat.birthtime);

        await processByVisualNotetaker(frames);

        const assetID = await uploadFile(filePath);
        await processByNotetaker(assetID, fileStat.birthtime);

        // delete audio file
        await promisifiedUnlink(filePath);
        delete lastFileSize[filePath];
      }
    }
  } catch (err) {
    console.error("Error processing directory:", err);
  } finally {
    setTimeout(() => {
      processScreenVideos();
    }, +process.env.SCREEN_VIDEO_PROCESSING_INTERVAL_IN_MS);
  }
};

module.exports = { processScreenVideos };
