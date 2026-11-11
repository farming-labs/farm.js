// In the browser build the plugin points this module at the provider's widget. Everywhere else,
// such as a server bundle or an app without the plugin, this empty default is what resolves.
const noWidget: unknown = undefined;
export default noWidget;
