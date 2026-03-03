let _bot = null;

module.exports = {
  setBot(bot) { _bot = bot; },
  getBot() { return _bot; },
};
