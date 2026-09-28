// FeedbackConfig.js -- where Send Feedback reports go. CI replaces the two
// @@ placeholders from GitHub Actions secrets before the build
// (tools/inject_feedback_config.py); a local build keeps them and cannot
// send, only save. tests/test_feedback_config.py fails if real values are
// ever committed here.
var FeedbackConfig = {
    ENDPOINT: "@@FEEDBACK_ENDPOINT@@",
    KEY: "@@FEEDBACK_KEY@@",
    EMAIL: "cavecad.app@gmail.com"
};
