window.SupportChat = {
  visitor: null,
  load(options) {
    this.visitor = options.visitor;
  },
  open() {
    return `Chat opened for ${this.visitor ?? "guest"}`;
  },
};
