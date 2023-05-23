// Import required modules
const express = require("express"); // express library for web application framework
const cors = require("cors"); // cors middleware for enabling cross-origin resource sharing
const axios = require("axios"); // axios library for making HTTP requests
const fs = require("fs"); // fs library for working with the file system
const { google } = require("googleapis"); // googleapis library for interacting with Google APIs
const { url } = require("inspector"); // inspector library for debugging Node.js applications
const { dbFirestore, dbRealtime } = require("./youtube_edu"); // import references to the Firebase databases
const dotenv = require("dotenv"); // dotenv library for working with environment variables

// Load environment variables from .env file
dotenv.config();

// Set the port for the server to listen on
const PORT = process.env.PORT;

// Set the API key to use with the YouTube API
const APIKEY = process.env.API_KEY;

// Set the base API URL to use for making requests
const BASEAPI_URL = process.env.BASEAPI_URL;

// Initialize the Express application
const app = express();

// Create a YouTube client with the specified API key
const youtube = google.youtube({
  version: "v3",
  auth: APIKEY,
});

// Enable cross-origin resource sharing for all routes
app.use(cors());

// Enable JSON body parsing for incoming requests
app.use(express.json());

// https://www.youtube.com/watch?v=

// https://www.googleapis.com/youtube/v3/serach?key=APIKEY&type=video&part=snippet&q=foo

// Route for the homepage
app.get("/", (req, res) => {
  res.send("Hello World");
});

// Define the /all route
app.get("/all", async (req, res, next) => {
  try {
    // Set up caching for the response data
    const cacheFile = "main.json";
    const cacheMaxAge = 60 * 60 * 1000; // 1 hour
    const cacheExists = fs.existsSync(cacheFile);
    const cacheIsFresh =
      cacheExists &&
      Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

    if (cacheIsFresh) {
      // If the data is cached, read it from the file and send it as the response
      fs.readFile(cacheFile, "utf-8", (err, data) => {
        if (err) throw err;
        const jsonData = JSON.parse(data);
        console.log("Cached data sent.");
        res.send(jsonData);
      });
    } else {
      // Get a reference to the "IDs" collection in Firestore, and retrieve the document with ID "all".
      const docRef = dbFirestore.collection("IDs").doc("all");
      const doc = await docRef.get();
      if (!doc.exists) {
        throw new Error("Document not found");
      }
      // Extract the channel IDs from the document.
      const keys = Object.values(doc.data());
      // Set the maximum number of videos to be returned, and search for the latest videos on each channel using the YouTube API.
      const maxResults = 10;
      const responses = await Promise.all(
        keys.map(async (key) => {
          const data = [];
          const response = await youtube.search.list({
            part: "snippet",
            channelId: key,
            type: "video",
            key: APIKEY,
            order: "date",
            maxResults: maxResults,
          });
          for (const video of response.data.items) {
            const videoInfo = await youtube.videos.list({
              part: "statistics",
              id: video.id.videoId,
              key: APIKEY,
            });
            const channelInfo = await youtube.channels.list({
              part: "snippet",
              id: video.snippet.channelId,
              key: APIKEY,
            });
            // Add the channel image and video view count to the video object.
            video.snippet.channelImage =
              channelInfo.data.items[0].snippet.thumbnails.default.url;
            video.statistics = videoInfo.data.items[0].statistics;
            data.push(video);
            if (data.length >= maxResults) {
              break;
            }
          }
          return data;
        })
      );
      // Merge the results from each channel, and send them in the response.
      const data = [...responses.flat()];
      // Sort the search results in reverse chronological order of publication date
      data.sort(
        (a, b) =>
          new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt)
      );
      // Cache the response data to a file for future requests
      fs.writeFile(cacheFile, JSON.stringify(data), (err) => {
        if (err) throw err;
        console.log("Data cached successfully.");
      });
      // Send the concatenated array of search results in the response
      res.send(data);
    }
  } catch (err) {
    if (err.code === 403) {
      // If the error is due to exceeding the YouTube API quota, attempt to send cached data from the file system.
      const cacheFile = "main.json";
      const cacheMaxAge = 60 * 60 * 1000; // 1 hour
      const cacheExists = fs.existsSync(cacheFile);
      const cacheIsFresh =
        cacheExists &&
        Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

      if (cacheIsFresh) {
        // If fresh cached data is available, read the data from the file and send it in the response.
        fs.readFile(cacheFile, "utf-8", (err, data) => {
          if (err) throw err;
          const jsonData = JSON.parse(data);
          console.log("Cached data sent.");
          res.send(jsonData);
        });
      }
    } else {
      // If an unexpected error occurs, log the error and pass it on to the next middleware function.
      console.log(`The Quota has been completed for all request.`);
      next(err);
    }
  }
});

// https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&maxResults=25&playlistId=PLBCF2DAC6FFB574DE&key=[YOUR_API_KEY]

// This route retrieves the categories from a Firestore collection and sends them as a response.
app.get("/categories", async (req, res, next) => {
  try {
    const categoriesRef = dbFirestore.collection("Categories"); // Get a reference to the "Categories" collection in Firestore.
    const snapshot = await categoriesRef.get(); // Retrieve a snapshot of the "Categories" collection.
    const categories = snapshot.docs.map((doc) => ({ ...doc.data() })); // Map the snapshot to an array of category objects.
    const keys = Object.values(categories[0]); // Extract the keys from the first category object.
    res.send(keys); // Send the keys as the response.
  } catch (error) {
    // Pass any errors to the next middleware function.
    next(error);
  }
});

// Create a function to get the channel IDs from Firestore.
async function getChannelIds(searchQuery) {
  // Convert the search query to lowercase.
  searchQuery = searchQuery.toLowerCase();

  // Retrieve the channel IDs from Firestore.
  const docSnapshot = await dbFirestore
    .collection("IDs")
    .doc(searchQuery)
    .get();
  if (!docSnapshot.exists) {
    throw new Error(`No channel IDs found for search query '${searchQuery}'`);
  }
  const channelIds = Object.values(docSnapshot.data());

  // Retrieve the channel IDs from Firestore for the 'all' document.
  const allDocSnapshot = await dbFirestore.collection("IDs").doc("all").get();
  if (!allDocSnapshot.exists) {
    throw new Error("No channel IDs found for document ID 'all'");
  }
  const allChannelIds = Object.values(allDocSnapshot.data());

  // Combine the channel IDs from the search query and the 'all' document.
  const combinedChannelIds = [...new Set([...channelIds, ...allChannelIds])];

  // Clear the cache.
  cachedChannelIds = null;

  return combinedChannelIds;
}

/**
 * An Express route handler for the /search endpoint.
 * Retrieves a search query from the request query parameters and searches for videos
 * that match the query on all the channels whose IDs are stored in Firestore.
 *
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 * @param {Function} next - The next middleware function.
 */
app.get("/search", async (req, res, next) => {
  try {
    // Retrieve the search query from the request query parameters.
    var searchQuery = req.query.search_query;
    searchQuery = searchQuery.toLowerCase();

    // Retrieve the channel IDs from Firestore or from the cache.
    const channelIds = await getChannelIds(searchQuery);

    // Create an array of promises, each of which retrieves videos and channel details that match the query
    // from one of the channels whose IDs are stored in Firestore.
    const promises = channelIds.map(async (channelId) => {
      const videoUrl = `${BASEAPI_URL}/search?part=snippet&channelId=${channelId}&q=${searchQuery}&type=video&key=${APIKEY}&maxResults=10`;
      const channelUrl = `${BASEAPI_URL}/channels?part=snippet,statistics&id=${channelId}&key=${APIKEY}`;

      const [videoResponse, channelResponse] = await Promise.all([
        axios.get(videoUrl),
        axios.get(channelUrl),
      ]);

      const videos = videoResponse.data.items;
      const channelData = channelResponse.data.items[0];

      return {
        channelId,
        channelImage: channelData.snippet.thumbnails.default.url,
        statistics: channelData.statistics,
        videos,
      };
    });

    // Wait for all the promises to resolve, and concatenate the results into a single array.
    const responses = await Promise.all(promises);
    const data = responses.reduce(
      (acc, response) =>
        acc.concat(
          response.videos.map((video) => ({
            ...video,
            snippet: {
              ...video.snippet,
              channelImage: response.channelImage,
            },
            statistics: response.statistics,
          }))
        ),
      []
    );

    // Send the concatenated array of search results in the response.
    res.send(data);
  } catch (err) {
    // Forward any errors to the next middleware function.
    if (err.code === 403) {
      const cacheFile = "main.json";
      const cacheMaxAge = 60 * 60 * 1000; // 1 hour
      const cacheExists = fs.existsSync(cacheFile);
      const cacheIsFresh =
        cacheExists &&
        Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

      if (cacheIsFresh) {
        fs.readFile(cacheFile, "utf-8", (err, data) => {
          if (err) throw err;
          const jsonData = JSON.parse(data);
          console.log("Cached data sent.");
          res.send(jsonData);
        });
      }
    }
    console.log("Quota completed for searching");
    // next(err);
  }
});

// Route to retrieve playlists matching a search query
app.get("/getPlaylist", async (req, res, next) => {
  try {
    // Retrieve data from Firestore collection
    const peopleRef = dbFirestore.collection("IDs");
    const snapshot = await peopleRef.get();
    const list = snapshot.docs.map((doc) => ({ ...doc.data() }));
    const searchQuery = req.query.search_query; // Retrieve the search query parameter from the request
    var data = []; // Initialize variables for playlist data and channel IDs
    var keys = Object.values(list[0]);

    // Loop through channel IDs and construct API request URL for each
    for (let i = 0; i < keys.length; i++) {
      const url = `${BASEAPI_URL}/search?type=playlist&part=snippet&channelId=${keys[i]}&q=${searchQuery}&key=${APIKEY}`;
      const response = await axios.get(url);
      data = data.concat(response.data.items);
    }

    // Send the playlist data in the response
    res.send(data);

    // Alternative code using the search endpoint with a max result limit of 50

    // const searchQuery = "programming languages";
    // const url = ${BASEAPI_URL}/search?key=${APIKEY}&type=playlist&part=snippet&q=${searchQuery}&maxResults=50;
    // const response = await axios.get(url);
    // res.send(response.data.items);
  } catch (err) {
    // Forward any errors to the error handler middleware
    if (err.code === 403) {
      const cacheFile = "main.json";
      const cacheMaxAge = 60 * 60 * 1000; // 1 hour
      const cacheExists = fs.existsSync(cacheFile);
      const cacheIsFresh =
        cacheExists &&
        Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

      if (cacheIsFresh) {
        fs.readFile(cacheFile, "utf-8", (err, data) => {
          if (err) throw err;
          const jsonData = JSON.parse(data);
          console.log("Cached data sent.");
          res.send(jsonData);
        });
      }
    }
    console.log("Quota completed for getting playlists");
    // next(err);
  }
});

// Route to retrieve data for a specified YouTube playlist
app.get("/getPlaylistData", async (req, res, next) => {
  try {
    const playListId = req.query.playListId; // Retrieve the playlist ID from the request parameters
    const url = `${BASEAPI_URL}/playlistItems?part=snippet%2CcontentDetails&maxResults=50&playlistId=${playListId}&key=${APIKEY}`; // Construct the API request URL with the playlist ID and API key
    const response = await axios.get(url); // Make the API request to retrieve the playlist data
    res.send(response.data.items); // Send the playlist items back to the client

    // Note: The following code is used for testing purposes only, to avoid making unnecessary API calls

    // fs.readFile("playlist.json", "utf-8", (err, data) => {
    //   if (err) throw err;
    //   const jsonData = JSON.parse(data);
    //   res.send(jsonData);
    // });
  } catch (err) {
    // Pass any errors to the error handling middleware
    next(err);
  }
});

// Route to search for videos using the YouTube Data API and return the results
app.get("/searchWithGoogleapis", async (req, res, next) => {
  try {
    const searchQuery = req.query.search_query; // Retrieve the search query parameter from the request
    // Call the YouTube Data API's search.list method to search for videos with the specified query
    const response = await youtube.search.list({
      part: "snippet",
      q: searchQuery,
      key: APIKEY,
      maxResults: 1,
    });
    res.send(response.data.items); // Extract the video search results from the API response and send them to the client
  } catch (err) {
    // Forward any errors to the error handling middleware
    next(err);
  }
});

// This endpoint retrieves data from YouTube API for a specified channel ID

// https://youtube.googleapis.com/youtube/v3/channels?part=snippet&id=UCWv7vMbMWH4-V0ZXdmDpPBA&key=[YOUR_API_KEY]

// OR

// Import required libraries and dependencies
// const axios = require("axios");
// const { google } = require("googleapis");
// const youtube = google.youtube({ version: "v3" });

// Route to retrieve information about a specific YouTube channel from the API
app.get("/getWhiteListedChannels", async (req, res, next) => {
  try {
    var data = []; // Initialize an empty array to store the retrieved data
    const channelId = req.query.search_query; // Retrieve the search query parameter from the request
    const url = `${BASEAPI_URL}/channels?part=snippet&id=${channelId}&key=${APIKEY}`; // Construct the API URL using the retrieved search query and API key
    const response = await axios.get(url); // Send a GET request to the API endpoint and retrieve the response data
    data = data.concat(response.data.items); // Extract the relevant data from the API response and add it to the data array
    res.send(data); // Send the retrieved data to the client
  } catch (err) {
    // Forward any errors to the error handling middleware
    next(err);
  }
});

// This route handles requests to retrieve data of a specific video from the YouTube Data API.

app.get("/videoData", async (req, res, next) => {
  try {
    const searchQuery = req.query.search_query; // Retrieve the search query parameter from the request.
    // Call the videos.list method of the YouTube Data API to retrieve the data of the specified video.
    const response = await youtube.videos.list({
      part: "snippet",
      id: searchQuery,
      maxResults: 1,
      fields: "items(id,snippet)", // retrieve only necessary fields
    });
    res.send(response.data.items); // Extract the video data from the API response and send it to the client.
  } catch (err) {
    // Forward any errors to the error handling middleware.
    next(err);
  }
});

// Note: The try-catch block ensures proper error handling and allows for graceful error messages to be returned to the client.
// Additionally, the comments provide a clear explanation of the code's purpose and functionality, making it easier to maintain and update in the future.

// Route to sort the video data by upload date and view count
// Handle GET requests to the /sorting endpoint
app.get("/sorting", async (req, res, next) => {
  try {
    // Retrieve the search query from the request query parameters.
    var searchQuery = req.query.search_query;
    searchQuery = searchQuery.toLowerCase();

    // Retrieve the channel IDs from Firestore or from the cache.
    const channelIds = await getChannelIds(searchQuery);

    // Create an array of promises, each of which retrieves videos and channel details that match the query
    // from one of the channels whose IDs are stored in Firestore.
    const promises = channelIds.map(async (channelId) => {
      const videoUrl = `${BASEAPI_URL}/search?part=snippet&channelId=${channelId}&q=${searchQuery}&type=video&key=${APIKEY}&maxResults=10`;
      const channelUrl = `${BASEAPI_URL}/channels?part=snippet,statistics&id=${channelId}&key=${APIKEY}`;

      const [videoResponse, channelResponse] = await Promise.all([
        axios.get(videoUrl),
        axios.get(channelUrl),
      ]);

      const videos = videoResponse.data.items;
      const channelData = channelResponse.data.items[0];

      return {
        channelId,
        channelImage: channelData.snippet.thumbnails.default.url,
        statistics: channelData.statistics,
        videos,
      };
    });

    // Wait for all the promises to resolve, and concatenate the results into a single array.
    const responses = await Promise.all(promises);
    const data = responses.reduce(
      (acc, response) =>
        acc.concat(
          response.videos.map((video) => ({
            ...video,
            snippet: {
              ...video.snippet,
              channelImage: response.channelImage,
            },
            statistics: response.statistics,
          }))
        ),
      []
    );

    // Send the concatenated array of search results in the response.
    data.sort(
      (a, b) =>
        new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt)
    );
    res.send(data); // Send the sorted video items as the response.
  } catch (err) {
    // Forward any errors to the next middleware function.
    if (err.code === 403) {
      const cacheFile = "main.json";
      const cacheMaxAge = 60 * 60 * 1000; // 1 hour
      const cacheExists = fs.existsSync(cacheFile);
      const cacheIsFresh =
        cacheExists &&
        Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

      if (cacheIsFresh) {
        fs.readFile(cacheFile, "utf-8", (err, data) => {
          if (err) throw err;
          const jsonData = JSON.parse(data);
          console.log("Cached data sent.");
          res.send(jsonData);
        });
      }
    }
    console.log("Quota completed for sorting");
    // next(err);
  }
});

// Define a route for sorting videos based on upload time
app.get("/sortingUploadTime", async (req, res, next) => {
  try {
    // Retrieve the search query from the request query parameters and convert to lowercase
    const searchQuery = req.query.search_query.toLowerCase();

    // Retrieve the channel IDs from Firestore or cache
    const channelIds = await getChannelIds(searchQuery);

    // Retrieve videos and channel details that match the query from the channels whose IDs are stored in Firestore
    const responses = await Promise.all(
      channelIds.map(async (channelId) => {
        const videoUrl = `${BASEAPI_URL}/search?part=snippet&channelId=${channelId}&q=${searchQuery}&type=video&key=${APIKEY}&maxResults=10`;
        const channelUrl = `${BASEAPI_URL}/channels?part=snippet,statistics&id=${channelId}&key=${APIKEY}`;

        const [videoResponse, channelResponse] = await Promise.all([
          axios.get(videoUrl),
          axios.get(channelUrl),
        ]);

        const videos = videoResponse.data.items;
        const channelData = channelResponse.data.items[0];

        return {
          channelId,
          channelImage: channelData.snippet.thumbnails.default.url,
          statistics: channelData.statistics,
          videos,
        };
      })
    );

    // Concatenate the results into a single array and sort by upload time
    const data = responses.reduce(
      (acc, response) =>
        acc.concat(
          response.videos.map((video) => ({
            ...video,
            snippet: {
              ...video.snippet,
              channelImage: response.channelImage,
            },
            statistics: response.statistics,
          }))
        ),
      []
    );
    data.sort(
      (a, b) =>
        new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt)
    );

    // Send the sorted video items as the response
    res.send(data);
  } catch (err) {
    // Handle any errors by forwarding to the next middleware function or sending cached data if quota is reached
    if (err.code === 403) {
      const cacheFile = "main.json";
      const cacheMaxAge = 60 * 60 * 1000; // 1 hour
      const cacheExists = fs.existsSync(cacheFile);
      const cacheIsFresh =
        cacheExists &&
        Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

      if (cacheIsFresh) {
        fs.readFile(cacheFile, "utf-8", (err, data) => {
          if (err) throw err;
          const jsonData = JSON.parse(data);
          console.log("Cached data sent.");
          res.send(jsonData);
        });
      }
    } else {
      console.log("Error in sortingUploadTimeHandler:", err);
      next(err);
    }
  }
});

// Route to retrieve search results sorted by view count
app.get("/sortingViewCount", async (req, res, next) => {
  try {
    // Retrieve the search query from the request query parameters.
    let searchQuery = req.query.search_query.toLowerCase();

    // Retrieve the channel IDs from Firestore or from the cache.
    const channelIds = await getChannelIds(searchQuery);

    // Create an array of promises, each of which retrieves videos and channel details that match the query
    // from one of the channels whose IDs are stored in Firestore.
    const promises = channelIds.map(async (channelId) => {
      const videoUrl = `${BASEAPI_URL}/search?part=snippet&channelId=${channelId}&order=viewCount&q=${searchQuery}&type=video&key=${APIKEY}&maxResults=10`;
      const channelUrl = `${BASEAPI_URL}/channels?part=snippet,statistics&id=${channelId}&key=${APIKEY}`;

      // Retrieve video and channel details for each channel using Promises.all()
      const [videoResponse, channelResponse] = await Promise.all([
        axios.get(videoUrl),
        axios.get(channelUrl),
      ]);

      // Extract the relevant data from the responses
      const videos = videoResponse.data.items;
      const channelData = channelResponse.data.items[0];

      return {
        channelId,
        channelImage: channelData.snippet.thumbnails.default.url,
        statistics: channelData.statistics,
        videos,
      };
    });

    // Wait for all the promises to resolve, and concatenate the results into a single array.
    const responses = await Promise.all(promises);
    const data = responses.reduce(
      (acc, response) =>
        acc.concat(
          response.videos.map((video) => ({
            ...video,
            snippet: {
              ...video.snippet,
              channelImage: response.channelImage,
            },
            statistics: response.statistics,
          }))
        ),
      []
    );

    // Send the concatenated array of search results in the response.
    res.send(data);
  } catch (err) {
    // Forward any errors to the next middleware function.
    if (err.code === 403) {
      // If API quota is exceeded, try to send data from cache (if it exists and is fresh)
      const cacheFile = "main.json";
      const cacheMaxAge = 60 * 60 * 1000; // 1 hour
      const cacheExists = fs.existsSync(cacheFile);
      const cacheIsFresh =
        cacheExists &&
        Date.now() - fs.statSync(cacheFile).mtime.getTime() < cacheMaxAge;

      if (cacheIsFresh) {
        fs.readFile(cacheFile, "utf-8", (err, data) => {
          if (err) throw err;
          const jsonData = JSON.parse(data);
          console.log("Cached data sent.");
          res.send(jsonData);
        });
      }
    }
    console.log("Quota completed for sorting by view count");
    // next(err);
  }
});

// This function is responsible for handling the "AddHistory" endpoint in the application.
app.put("/AddHistory", async (req, res, next) => {
  try {
    // Extract the required parameters from the query string of the HTTP request.
    const {
      email,
      video_id,
      time_now,
      desc,
      channel_title,
      channel_name,
      thumb_nail,
      channelImage,
    } = req.query;
    const notes = req.body; // Extract the notes from the body of the HTTP request.
    // Retrieve a reference to the Firebase Realtime Database, pointing to the "Users" node
    // and the specific user's "Videodata" child node.
    const ref = await dbRealtime.ref("Users").child(email).child("Videodata");
    // Construct the data object that will be added to the Realtime Database.
    const body = {
      videoId: video_id,
      Timenow: time_now,
      Description: desc,
      ChannelTitle: channel_title,
      ChannelName: channel_name,
      Thumbnail: thumb_nail,
      Notes: notes,
      channelImage: channelImage,
    };
    const respond = await ref.child(video_id).set(body); // Add the data to the Realtime Database at the specified location.
    res.send(respond); // Send the HTTP response containing the response data.
  } catch (err) {
    // If an error occurs, pass it on to the "next" middleware function.
    next(err);
  }
});

// This function handles the "getClickedVideoData" endpoint in the application. It retrieves the data for a single video that was clicked by the user.
// The function takes in an HTTP request object (req), a response object (res), and a "next" callback function.
app.get("/getClickedVideoData", async (req, res, next) => {
  try {
    var data = []; // Initialize an empty array to store the retrieved video data.
    const { email, video_id } = req.query; // Extract the required parameters from the query string of the HTTP request.
    // Retrieve a reference to the Firebase Realtime Database, pointing to the "Users" node,
    // the specific user's "Videodata" child node, and the child node corresponding to the clicked video.
    const ref = dbRealtime
      .ref("Users")
      .child(email)
      .child("Videodata")
      .child(video_id);
    const snapshot = await ref.once("value"); // Retrieve the data from the specified location in the Realtime Database.
    const list = snapshot.val();
    // If no data is found for the specified user and video, return a 404 status code with an error message.
    if (list === null) {
      return res
        .status(404)
        .json({ message: "No watch history found for this user" });
    }
    data = data.concat(list); // Append the retrieved data to the "data" array.
    return res.status(200).json(data); // Return the HTTP response containing the retrieved data.
  } catch (err) {
    // If an error occurs, pass it on to the "next" middleware function.
    next(err);
  }
});

// Define an endpoint for fetching the watch history of a user.
app.get("/watchHistory", async (req, res, next) => {
  try {
    // Extract the search query from the request parameters.
    const childPath = req.query.search_query;

    // Create a reference to the database location containing the user's video data, sorted by timestamp.
    const ref = dbRealtime
      .ref("Users")
      .child(childPath)
      .child("Videodata")
      .orderByChild("Timenow");

    // Retrieve the data from the database location as a single snapshot.
    const snapshot = await ref.once("value");

    // Extract the data from the snapshot.
    const list = snapshot.val();

    // If no data is found, return a 404 error.
    if (list === null) {
      return res
        .status(404)
        .json({ message: "No watch history found for this user" });
    }

    // Convert the data object to an array and sort it by timestamp in descending order.
    let data = Object.values(list);
    data.sort((a, b) => {
      if (a.Timenow < b.Timenow) {
        return 1;
      } else if (a.Timenow > b.Timenow) {
        return -1;
      }
      return 0;
    });

    // Return the sorted data as a JSON response.
    return res.status(200).json(data);
  } catch (err) {
    // If an error occurs, pass it to the error handler middleware.
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err);
  }
});

// Optimize the API endpoint to update video playback time for a given user
app.put("/updateHistoryTime", async (req, res, next) => {
  try {
    const { email, video_id, time_now } = req.query; // Extract the query parameters from the request
    // Get a reference to the specific video data for the user in the Realtime Database
    const ref = dbRealtime
      .ref("Users")
      .child(email)
      .child("Videodata")
      .child(video_id);
    const body = { Timenow: time_now }; // Create an object with the new time value to update the database with
    await ref.update(body); // Use Firebase's batched writes to update the database with the new time value
    res.send("OK"); // Send a simple "OK" response to the client
  } catch (err) {
    // Handle any errors that occur during the update operation
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err);
  }
});

// HTTP PUT endpoint to add categories to the white list

app.put("/addcategorieswhitelist", async (req, res) => {
  try {
    const id = "Z6ytPTHJANaMWRH5O920"; // Set the ID of the document to be updated
    const data = req.body; // Get the new data from the request body
    const peopleRef = dbFirestore.collection("Categories"); // Get reference to the "Categories" collection in Firestore
    const snapshot = await peopleRef.get(); // Get a snapshot of the collection
    const list = snapshot.docs.map((doc) => ({ ...doc.data() })); // Map the snapshot documents to an array of data objects
    peopleRef.doc(id).set(data, { merge: true }); // Set the new data in the document with the specified ID, merging the new data with any existing data in the document
    res.send("Added"); // Send a success message as the HTTP response
  } catch (err) {
    // Handle errors appropriately
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err);
  }
});

// Route to fetch categories whitelist
app.get("/fetchcategorieswhitelist", async (req, res, next) => {
  try {
    // Declare an empty array to store keys
    var keys = [];
    // Get reference to the 'Categories' collection from Firestore database
    const peopleRef = dbFirestore.collection("Categories");
    // Retrieve the documents from the collection
    const snapshot = await peopleRef.get();
    // Extract data from the documents and map it to a new array
    const list = snapshot.docs.map((doc) => ({ ...doc.data() }));
    // Extract the key-value pairs from the first document in the array
    keys = keys.concat(Object.entries(Object(list[0])));
    // Send the array of keys as the response
    res.send(keys);
  } catch (err) {
    // Pass on the error to the error handling middleware
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err);
  }
});

// Endpoint to fetch white listed categories

app.get("/mainscreencatgorieswhitelist", async (req, res, next) => {
  try {
    const categoriesRef = dbFirestore.collection("Categories"); // Get a reference to the "Categories" collection in Firestore.
    const snapshot = await categoriesRef.get(); // Retrieve a snapshot of the "Categories" collection.
    const categories = snapshot.docs.map((doc) => ({ ...doc.data() })); // Map the snapshot to an array of category objects.
    const keys = Object.values(categories[0]); // Extract the keys from the first category object.
    res.send(keys); // Send the keys as the response.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err); // Pass any errors to the next middleware function in the chain
  }
});

// Update Categories in Whitelist

app.put("/updatecategorieswhitelist", async (req, res, next) => {
  try {
    const id = "Z6ytPTHJANaMWRH5O920"; // Set the ID of the document to be updated
    delete req.body.id; // Delete the "id" property from the request body, since it is not intended for update
    const data = req.body; // Store the updated data in a variable
    const peopleRef = dbFirestore.collection("Categories"); // Get a reference to the "Categories" collection in Firestore
    const response = await peopleRef.doc(id).update(data, { merge: true }); // Update the document with the specified ID, merging the new data with any existing data in the document
    res.send(response); // Send the response, which will be the result of the update operation
  } catch (error) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(error); // Pass any errors to the next middleware function in the chain
  }
});

// Deleting Categories which are White Listed

app.put("/deletecategorieswhitelist", async (req, res, next) => {
  try {
    // Import the FieldValue module from Firebase Admin to allow for deleting specific fields
    const FieldValue = require("firebase-admin").firestore.FieldValue;
    const id = "Z6ytPTHJANaMWRH5O920"; // Set the ID of the document to be updated
    const data = req.query.search_query; // Extract the field name to be deleted from the request query parameters
    const peopleRef = dbFirestore.collection("Categories").doc(id); // Get a reference to the specified document in the Categories collection
    const respond = await peopleRef.update({ [data]: FieldValue.delete() }); // Use the FieldValue.delete() method to delete the specified field from the document
    res.send(respond); // Send the response, which will be the result of the update operation
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err); // Pass any errors to the next middleware function in the chain
  }
});

// White listed channels Starts here

// Define a route to handle incoming PUT requests to add a new ID to the whitelist

app.put("/addwhitelistId", async (req, res, next) => {
  try {
    var id = req.query.search_query; // Set the ID to a default value of "ALL"
    id = id.toLowerCase();
    const data = req.body; // Get the request body data
    const peopleRef = dbFirestore.collection("IDs"); // Get a reference to the "IDs" collection in Firestore
    const snapshot = await peopleRef.get(); // Retrieve a snapshot of the documents in the collection
    const list = snapshot.docs.map((doc) => ({ ...doc.data() })); // Map the documents to an array of their data objects
    peopleRef.doc(id).set(data, { merge: true }); // Add the new ID to the collection, or update it if it already exists
    res.send("Added"); // Send a success message to the client
  } catch (err) {
    // Pass any errors to the next middleware function
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err);
  }
});

app.get("/fetchwhitelistId", async (req, res, next) => {
  try {
    const peopleRef = dbFirestore.collection("IDs");
    const snapshot = await peopleRef.get();
    const data = [];
    snapshot.forEach((doc) => {
      const docData = doc.data();
      const keyData = Object.assign({ id: doc.id }, docData);
      data.push(keyData);
    });
    res.send(data);
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // next(err);
  }
});

// This route updates the categories which are white listed.

app.put("/updatewhitelistId", async (req, res, next) => {
  try {
    const id = "ALL";
    delete req.body.id; // The request body does not need to contain an ID, so we delete it.
    const data = req.body; // We get a reference to the "IDs" collection in Firestore.
    const peopleRef = dbFirestore.collection("IDs");
    const respond = await peopleRef.doc(id).update(data, { merge: true }); // We update the document with the ID "ALL" with the data from the request body, while merging it with any existing data.
    res.send(respond); // We send the response back to the client.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // If there was an error, we pass it to the error handling middleware.
    // next(err);
  }
});

// Define route to remove a value from a specific document
app.put("/deletewhitelistId", async (req, res, next) => {
  try {
    const admin = require("firebase-admin");
    const db = admin.firestore();
    const collectionName = "IDs";
    const { document, field } = req.query;

    // Get a reference to the document
    const docRef = db.collection(collectionName).doc(document);

    // Check if the field exists in the document
    const doc = await docRef.get();
    if (!doc.exists || !doc.get(field)) {
      return res
        .status(404)
        .send(`Field ${field} not found in Document ${document}.`);
    }

    // Remove the key-value pair from the document
    await docRef.update({
      [field]: admin.firestore.FieldValue.delete(),
    });

    res.send(`Field ${field} of Document ${document} deleted successfully.`);
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // If there was an error, we pass it to the error handling middleware.
    // next(err);
  }
});

// White listed channels Ends here

// Black listed channels Starts here

// This endpoint is used to add a video ID to the blacklist.
app.put("/addblacklistId", async (req, res, next) => {
  try {
    const id = "YoPdyY2LXMqSoLmGGJL8"; // Define the ID of the document to be updated.
    const data = req.body; // Extract the request body from the incoming request object.
    const peopleRef = dbFirestore.collection("Blacklist"); // Get a reference to the 'Blacklist' collection.
    const snapshot = await peopleRef.get(); // Get a snapshot of the 'Blacklist' collection to obtain all existing documents.
    const list = snapshot.docs.map((doc) => ({ ...doc.data() })); // Map through the snapshot and create an array of the document data.
    peopleRef.doc(id).set(data, { merge: true }); // Set the document with the specified ID to the new data, merging any existing fields.
    res.send("Added"); // Send a success response back to the client.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // Forward any errors to the global error handler middleware.
    // next(err);
  }
});

// This endpoint is used to fetch all video IDs that are currently blacklisted.
app.get("/fetchblacklistId", async (req, res, next) => {
  try {
    var keys = []; // Define an empty array to hold the keys of the blacklisted IDs.
    const peopleRef = dbFirestore.collection("Blacklist"); // Get a reference to the 'Blacklist' collection.
    const snapshot = await peopleRef.get(); // Get a snapshot of the 'Blacklist' collection to obtain all existing documents.
    const list = snapshot.docs.map((doc) => ({ ...doc.data() })); // Map through the snapshot and create an array of the document data.
    keys = keys.concat(Object.entries(Object(list[0]))); // Concatenate all the keys of the first document in the list to the 'keys' array.
    res.send(keys); // Send the 'keys' array as the response back to the client.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // Forward any errors to the global error handler middleware.
    // next(err);
  }
});

// This endpoint is used to delete a category from the blacklist.
app.put("/deleteblacklistlistId", async (req, res, next) => {
  try {
    const FieldValue = require("firebase-admin").firestore.FieldValue; // Import the FieldValue module from the 'firebase-admin' package.
    const id = "YoPdyY2LXMqSoLmGGJL8"; // Define the ID of the document to be updated.
    const data = req.query.search_query; // Extract the search query from the incoming request object.
    const peopleRef = dbFirestore.collection("Blacklist").doc(id); // Get a reference to the document with the specified ID in the 'Blacklist' collection.
    const respond = await peopleRef.update({ [data]: FieldValue.delete() }); // Update the document to delete the specified category.
    res.send(respond); // Send a success response back to the client.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // Forward any errors to the global error handler middleware.
    // next(err);
  }
});

// Black listed channels ends here

// This endpoint handles requests to add a new user's whitelist request to the Realtime Database.
app.put("/addWhitelistRequest", async (req, res, next) => {
  try {
    const { email, youtube_link, category, is_true, new_category } = req.query; // Extract necessary data from the request query string.
    const ref = await dbRealtime.ref("Users").child(email).child("Requested"); // Set the Realtime Database reference to the user's "Requested" child node.
    // Define the data object to be pushed to the Realtime Database.
    const body = {
      Categories: category,
      new_category: new_category,
      YoutubeLink: youtube_link,
      is_true: is_true,
      user_id: email,
    };
    const respond = await ref.push(body); // Push the data object to the user's "Requested" node in the Realtime Database.
    res.send(respond); // Send the response to the client.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // If an error occurs during the update, pass it along to the next middleware.
    // next(err);
  }
});

// This endpoint is used to fetch all the whitelisting requests made by the users.
app.get("/fetchwhitelistingrequests", async (req, res, next) => {
  try {
    const ref = dbRealtime.ref("Users"); // Get a reference to the 'Users' node in the Realtime Database.
    var list = [];
    // Retrieve a snapshot of the data at the 'Users' node.
    await ref.once("value", (snapshot) => {
      snapshot.forEach(function (childSnapshot) {
        // Add the key of each child node to the 'list' array.
        list = list.concat(childSnapshot.key);
      });
    });
    // Fetch the whitelisting requests for each user and store them in the 'val1' array.
    const val1 = await Promise.all(
      list.map(async (items, i) => {
        const new_ref = dbRealtime.ref("Users").child(items).child("Requested"); // Get a reference to the 'Requested' node under the current user.
        const snapshot = await new_ref.once("value"); // Retrieve a snapshot of the data at the 'Requested' node.
        const myData = { ...Object(snapshot.val()) }; // Convert the snapshot data to a JavaScript object.
        return myData;
      })
    );
    // Filter out any empty objects from the 'val1' array.
    const filteredVal1 = val1.filter((obj) => {
      if (Object.keys(obj).length !== 0) return true;
    });
    var x = [];
    // Combine all the whitelisting requests into a single object.
    x = x.concat(
      filteredVal1.reduce(
        (result, current) => Object.assign(result, current),
        {}
      )
    );
    res.send(Object.entries(x[0])); // Convert the object into an array and send it back to the client.
  } catch (err) {
    if (err.code === 403) {
      console.log("The quota has been completed");
    }
    // Forward any errors to the global error handler middleware.
    // next(err);
  }
});

// This function handles the "addStatusTrue" endpoint in the application. It updates the status of a user's request to "true" once the request has been fulfilled.
// The function takes in an HTTP request object (req), a response object (res), and a "next" callback function.
app.put("/addStatusTrue", async (req, res, next) => {
  try {
    const { email, req_id } = req.query; // Extract the required parameters from the query string of the HTTP request.
    // Retrieve a reference to the Firebase Realtime Database, pointing to the "Users" node,
    // the specific user's "Requested" child node, and the child node corresponding to the request ID.
    const ref = await dbRealtime
      .ref("Users")
      .child(email)
      .child("Requested")
      .child(req_id);
    const body = { is_true: "true" }; // Construct the data object that will be used to update the status of the request.
    const respond = await ref.update(body); // Update the status of the request in the Realtime Database.
    res.send(respond); // Send the HTTP response containing the response data.
  } catch (err) {
    // If an error occurs, pass it on to the "next" middleware function.
    next(err);
  }
});

// This route is used to update a user's requested status to false
// It expects an email and request ID in the request query parameters
app.put("/addStatusFalse", async (req, res, next) => {
  try {
    const { email, req_id } = req.query; // Extract the email and request ID from the request query parameters
    // Get a reference to the requested object in the user's Realtime Database node
    const ref = await dbRealtime
      .ref("Users")
      .child(email)
      .child("Requested")
      .child(req_id);
    const body = { is_true: "false" }; // Define the object that will be used to update the requested object
    const respond = await ref.update(body); // Update the requested object with the new status
    res.send(respond); // Send the response back to the client with the updated requested object
  } catch (err) {
    // If an error occurs during the update, pass it along to the next middleware
    next(err);
  }
});

// This function updates the notes associated with a specific video for a given user in the Realtime Database.
// It expects an email and video_id to be passed in as query parameters and the notes to be updated to be passed in as the request body.
app.put("/updateNotes", async (req, res, next) => {
  try {
    const { email, video_id } = req.query; // Extract the email and video_id from the query parameters
    const notes = req.body; // Extract the notes to be updated from the request body
    // Create a reference to the Video data for the given user and video_id
    const ref = await dbRealtime
      .ref("Users")
      .child(email)
      .child("Videodata")
      .child(video_id);
    const body = { Notes: notes }; // Create an object with the new notes to be updated
    const respond = await ref.update(body); // Update the notes in the Realtime Database
    res.send(respond); // Send a response with the updated notes
  } catch (err) {
    // If an error occurs, pass it to the next middleware function
    next(err);
  }
});

// This function retrieves the notes associated with a specific video for a given user from the Realtime Database.
// It expects an email and video_id to be passed in as query parameters.
app.get("/getNotes", async (req, res, next) => {
  try {
    var data = []; // Create an empty array to store the retrieved data
    const { email, video_id } = req.query; // Extract the email and video_id from the query parameters
    // Create a reference to the Video data for the given user and video_id
    const ref = await dbRealtime
      .ref("Users")
      .child(email)
      .child("Videodata")
      .child(video_id);
    // Listen for changes to the data at the reference
    ref.on("value", (snapshot) => {
      data = data.concat(snapshot.val()); // When the data changes, concatenate it to the existing data array
    });
    res.send(data); // Send the retrieved data in the response
  } catch (err) {
    // If an error occurs, pass it to the next middleware function
    next(err);
  }
});

// Listening for incoming requests on the specified PORT
app.listen(PORT, () => {
  // Outputting a message to the console indicating the server is listening on the specified PORT
  console.log(`Listening on PORT: ${PORT}`);
});
