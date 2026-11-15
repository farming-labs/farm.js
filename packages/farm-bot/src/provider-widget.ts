// In the browser build the plugin points this module at the provider's widget. Everywhere else,
// such as a server bundle or a build that didn't run the plugin's `configure`, this marker is what
// resolves, so `startBotWidget` can say which half is missing.
const noWidget: unknown = Symbol.for("@farm.js/bot/no-widget");
export default noWidget;
