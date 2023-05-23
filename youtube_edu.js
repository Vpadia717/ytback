// Import the firebase-admin module
const firebase = require("firebase-admin");

// Import the service account credentials for the Firebase app
const serviceAccount = require("./education-6fc79-firebase-adminsdk-sddla-eaf2ee117a.json");

// Initialize the Firebase app with the provided credentials
firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: "https://education-6fc79-default-rtdb.firebaseio.com",
  projectId: "education-6fc79",
});

// Get a reference to the real-time database
const dbRealtime = firebase.database();

// Get a reference to the Firestore database
const dbFirestore = firebase.firestore();

// Export the real-time and Firestore database references for use in other modules
module.exports = { dbFirestore, dbRealtime };
