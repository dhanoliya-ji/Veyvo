// Extends app.json. google-services.json is kept out of git; on EAS Build it is provided
// through the GOOGLE_SERVICES_JSON file environment variable (see docs/deployment.md).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
